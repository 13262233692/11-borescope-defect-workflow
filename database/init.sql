-- ============================================================
-- 航空发动机孔探缺陷工单流转系统 - 数据库初始化脚本
-- PostgreSQL 15+
-- ============================================================

-- 扩展
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. 枚举类型定义
-- ============================================================

-- 用户角色
DO $$ BEGIN
    CREATE TYPE user_role AS ENUM ('INSPECTOR', 'REVIEWER', 'RELEASER', 'ADMIN');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 工单状态
DO $$ BEGIN
    CREATE TYPE case_status AS ENUM (
        'PENDING',     -- 待判读
        'REVIEWING',   -- 待复核
        'REPAIR',      -- 需维修
        'CLEAR',       -- 可放行
        'CLOSED'       -- 已关闭
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 缺陷严重程度
DO $$ BEGIN
    CREATE TYPE defect_severity AS ENUM ('MINOR', 'MODERATE', 'MAJOR', 'CRITICAL');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 缺陷类型
DO $$ BEGIN
    CREATE TYPE defect_type AS ENUM (
        'CRACK',         -- 裂纹
        'CORROSION',     -- 腐蚀
        'DEFORMATION',   -- 变形
        'DEBRIS',        -- 异物
        'BURN',          -- 烧蚀
        'WEAR',          -- 磨损
        'OTHER'          -- 其他
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 工作流操作类型
DO $$ BEGIN
    CREATE TYPE workflow_action AS ENUM (
        'CREATE',        -- 创建
        'SUBMIT',        -- 提交判读
        'REVIEW_PASS',   -- 复核通过
        'REVIEW_REJECT', -- 复核退回
        'RELEASE',       -- 签发放行
        'CLOSE',         -- 关闭工单
        'COMMENT',       -- 添加评论
        'EDIT_ANNOTATION' -- 编辑标注
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ============================================================
-- 2. 核心表结构
-- ============================================================

-- 2.1 用户表
CREATE TABLE IF NOT EXISTS app_user (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    username VARCHAR(50) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    role user_role NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    badge_number VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.2 发动机台账表
CREATE TABLE IF NOT EXISTS engine (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    engine_serial VARCHAR(100) UNIQUE NOT NULL,
    model VARCHAR(100) NOT NULL,
    manufacturer VARCHAR(100) NOT NULL,
    operator VARCHAR(100),
    aircraft_registration VARCHAR(20),
    tsn NUMERIC(12, 2) DEFAULT 0,
    csn NUMERIC(12, 2) DEFAULT 0,
    tso NUMERIC(12, 2) DEFAULT 0,
    cso NUMERIC(12, 2) DEFAULT 0,
    status VARCHAR(50) DEFAULT 'ACTIVE',
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.3 孔探批次/工单表
CREATE TABLE IF NOT EXISTS inspection_case (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_number VARCHAR(50) UNIQUE NOT NULL,
    engine_id UUID NOT NULL REFERENCES engine(id) ON DELETE RESTRICT,
    inspection_date DATE NOT NULL,
    inspection_type VARCHAR(50) NOT NULL,
    borescope_model VARCHAR(100),
    section VARCHAR(100) NOT NULL,
    stage VARCHAR(50),
    location VARCHAR(200),
    status case_status DEFAULT 'PENDING' NOT NULL,
    inspector_id UUID REFERENCES app_user(id),
    reviewer_id UUID REFERENCES app_user(id),
    releaser_id UUID REFERENCES app_user(id),
    summary TEXT,
    conclusion TEXT,
    release_certificate_no VARCHAR(100),
    released_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    version INTEGER DEFAULT 1 NOT NULL
);

-- 2.4 孔探图像资源表
CREATE TABLE IF NOT EXISTS inspection_image (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES inspection_case(id) ON DELETE CASCADE,
    file_name VARCHAR(255) NOT NULL,
    original_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(50),
    file_size BIGINT,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    tile_size INTEGER DEFAULT 256,
    max_level INTEGER,
    has_tiles BOOLEAN DEFAULT false,
    tile_base_path VARCHAR(500),
    thumbnail_path VARCHAR(500),
    description TEXT,
    capture_datetime TIMESTAMPTZ,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2.5 图片瓦片索引表（用于加速瓦片查询）
CREATE TABLE IF NOT EXISTS image_tile (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    image_id UUID NOT NULL REFERENCES inspection_image(id) ON DELETE CASCADE,
    zoom_level INTEGER NOT NULL,
    tile_x INTEGER NOT NULL,
    tile_y INTEGER NOT NULL,
    tile_path VARCHAR(500) NOT NULL,
    width INTEGER,
    height INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(image_id, zoom_level, tile_x, tile_y)
);

-- 2.6 缺陷标注表
CREATE TABLE IF NOT EXISTS defect_annotation (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES inspection_case(id) ON DELETE CASCADE,
    image_id UUID NOT NULL REFERENCES inspection_image(id) ON DELETE CASCADE,
    defect_type defect_type NOT NULL,
    severity defect_severity NOT NULL,
    description TEXT,
    -- 矩形框坐标（原图百分比，0-1）
    x1 DOUBLE PRECISION NOT NULL,
    y1 DOUBLE PRECISION NOT NULL,
    x2 DOUBLE PRECISION NOT NULL,
    y2 DOUBLE PRECISION NOT NULL,
    -- 可选多边形（JSON 数组点）
    polygon JSONB,
    measurement NUMERIC(10, 4),
    measurement_unit VARCHAR(20),
    created_by UUID NOT NULL REFERENCES app_user(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_by UUID REFERENCES app_user(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    is_deleted BOOLEAN DEFAULT false,
    version INTEGER DEFAULT 1 NOT NULL,
    conflict_token UUID DEFAULT uuid_generate_v4()
);

-- 2.7 工作流记录/审批日志表
CREATE TABLE IF NOT EXISTS workflow_record (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    case_id UUID NOT NULL REFERENCES inspection_case(id) ON DELETE CASCADE,
    action workflow_action NOT NULL,
    from_status case_status,
    to_status case_status,
    actor_id UUID NOT NULL REFERENCES app_user(id),
    comment TEXT,
    annotation_id UUID REFERENCES defect_annotation(id) ON DELETE SET NULL,
    metadata JSONB,
    client_timestamp TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- 3. 索引
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_user_role ON app_user(role);
CREATE INDEX IF NOT EXISTS idx_case_engine ON inspection_case(engine_id);
CREATE INDEX IF NOT EXISTS idx_case_status ON inspection_case(status);
CREATE INDEX IF NOT EXISTS idx_case_inspector ON inspection_case(inspector_id);
CREATE INDEX IF NOT EXISTS idx_case_reviewer ON inspection_case(reviewer_id);
CREATE INDEX IF NOT EXISTS idx_case_created ON inspection_case(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_image_case ON inspection_image(case_id);
CREATE INDEX IF NOT EXISTS idx_annotation_case ON defect_annotation(case_id);
CREATE INDEX IF NOT EXISTS idx_annotation_image ON defect_annotation(image_id);
CREATE INDEX IF NOT EXISTS idx_annotation_type ON defect_annotation(defect_type);
CREATE INDEX IF NOT EXISTS idx_annotation_severity ON defect_annotation(severity);
CREATE INDEX IF NOT EXISTS idx_workflow_case ON workflow_record(case_id);
CREATE INDEX IF NOT EXISTS idx_workflow_created ON workflow_record(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tile_image_zoom ON image_tile(image_id, zoom_level);

-- ============================================================
-- 4. 状态机 - 合法状态流转表
-- ============================================================

CREATE TABLE IF NOT EXISTS status_transition (
    from_status case_status NOT NULL,
    to_status case_status NOT NULL,
    required_role user_role NOT NULL,
    description VARCHAR(200),
    PRIMARY KEY (from_status, to_status)
);

INSERT INTO status_transition (from_status, to_status, required_role, description) VALUES
    ('PENDING',   'REVIEWING', 'INSPECTOR', '判读员提交判读'),
    ('REVIEWING', 'REPAIR',    'REVIEWER',  '复核员判定需维修'),
    ('REVIEWING', 'CLEAR',     'REVIEWER',  '复核员判定可放行'),
    ('REVIEWING', 'PENDING',   'REVIEWER',  '复核员退回待判读'),
    ('REPAIR',    'CLOSED',    'RELEASER',  '放行工程师关闭维修工单'),
    ('CLEAR',     'CLOSED',    'RELEASER',  '放行工程师关闭放行工单'),
    ('PENDING',   'CLOSED',    'ADMIN',     '管理员强制关闭'),
    ('REVIEWING', 'CLOSED',    'ADMIN',     '管理员强制关闭'),
    ('REPAIR',    'REVIEWING', 'INSPECTOR', '判读员修复后重新提交')
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5. 触发器和函数
-- ============================================================

-- 5.1 自动更新时间戳函数
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5.2 工单状态流转校验函数
CREATE OR REPLACE FUNCTION validate_case_transition()
RETURNS TRIGGER AS $$
DECLARE
    transition_exists INTEGER;
BEGIN
    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
        RETURN NEW;
    END IF;

    SELECT COUNT(*) INTO transition_exists
    FROM status_transition
    WHERE from_status = OLD.status AND to_status = NEW.status;

    IF transition_exists = 0 THEN
        RAISE EXCEPTION '非法状态流转: % -> %', OLD.status, NEW.status;
    END IF;

    NEW.version = OLD.version + 1;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 5.3 缺陷标注版本递增
CREATE OR REPLACE FUNCTION increment_annotation_version()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted OR
       NEW.x1 != OLD.x1 OR NEW.y1 != OLD.y1 OR
       NEW.x2 != OLD.x2 OR NEW.y2 != OLD.y2 OR
       NEW.defect_type != OLD.defect_type OR
       NEW.severity != OLD.severity THEN
        NEW.version = OLD.version + 1;
        NEW.conflict_token = uuid_generate_v4();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 绑定触发器
DROP TRIGGER IF EXISTS user_timestamp ON app_user;
CREATE TRIGGER user_timestamp BEFORE UPDATE ON app_user
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS engine_timestamp ON engine;
CREATE TRIGGER engine_timestamp BEFORE UPDATE ON engine
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS case_timestamp ON inspection_case;
CREATE TRIGGER case_timestamp BEFORE UPDATE ON inspection_case
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS case_transition ON inspection_case;
CREATE TRIGGER case_transition BEFORE UPDATE ON inspection_case
    FOR EACH ROW EXECUTE FUNCTION validate_case_transition();

DROP TRIGGER IF EXISTS image_timestamp ON inspection_image;
CREATE TRIGGER image_timestamp BEFORE UPDATE ON inspection_image
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS annotation_timestamp ON defect_annotation;
CREATE TRIGGER annotation_timestamp BEFORE UPDATE ON defect_annotation
    FOR EACH ROW EXECUTE FUNCTION update_timestamp();

DROP TRIGGER IF EXISTS annotation_version ON defect_annotation;
CREATE TRIGGER annotation_version BEFORE UPDATE ON defect_annotation
    FOR EACH ROW EXECUTE FUNCTION increment_annotation_version();

-- ============================================================
-- 6. 初始化测试数据
-- ============================================================

-- 测试用户 (密码: 用户名+123, bcrypt hash)
-- 实际哈希通过 Node.js 的 bcrypt 生成，这里使用已知的测试哈希
INSERT INTO app_user (id, username, password_hash, display_name, role, email, badge_number) VALUES
    ('11111111-1111-1111-1111-111111111101', 'admin',
     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
     '系统管理员', 'ADMIN', 'admin@airline.com', 'ADM-001'),
    ('11111111-1111-1111-1111-111111111102', 'inspector',
     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
     '张判读', 'INSPECTOR', 'zhang.inspector@airline.com', 'INS-001'),
    ('11111111-1111-1111-1111-111111111103', 'inspector2',
     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
     '李判读', 'INSPECTOR', 'li.inspector@airline.com', 'INS-002'),
    ('11111111-1111-1111-1111-111111111104', 'reviewer',
     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
     '王复核', 'REVIEWER', 'wang.reviewer@airline.com', 'REV-001'),
    ('11111111-1111-1111-1111-111111111105', 'releaser',
     '$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
     '赵放行', 'RELEASER', 'zhao.releaser@airline.com', 'REL-001')
ON CONFLICT (username) DO NOTHING;

-- 测试发动机
INSERT INTO engine (id, engine_serial, model, manufacturer, operator, aircraft_registration, tsn, csn) VALUES
    ('22222222-2222-2222-2222-222222222201', 'CFM56-7B-12345', 'CFM56-7B26', 'CFM International', 'China Eastern', 'B-1234', 45678.5, 8523.2),
    ('22222222-2222-2222-2222-222222222202', 'GE90-115B-98765', 'GE90-115B', 'GE Aerospace', 'China Southern', 'B-5678', 23456.8, 4125.6),
    ('22222222-2222-2222-2222-222222222203', 'PW1000G-55432', 'PW1100G-JM', 'Pratt & Whitney', 'Air China', 'B-9999', 12890.3, 2345.1)
ON CONFLICT (engine_serial) DO NOTHING;

-- 测试工单
INSERT INTO inspection_case (
    id, case_number, engine_id, inspection_date, inspection_type,
    borescope_model, section, stage, location, status,
    inspector_id, created_by, summary
) VALUES
    ('33333333-3333-3333-3333-333333333301', 'BS-2026-0001', '22222222-2222-2222-2222-222222222201',
     '2026-06-15', 'A检孔探', 'Olympus IPLEX NX', '高压涡轮(HPT)', '第1级', '导向叶片#5位置',
     'PENDING', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102',
     'CFM56高压涡轮第1级导向叶片例行孔探检查'),
    ('33333333-3333-3333-3333-333333333302', 'BS-2026-0002', '22222222-2222-2222-2222-222222222202',
     '2026-06-18', 'C检孔探', 'GE Everest XL Pro', '燃烧室(CCOMB)', '主燃区', '燃油喷嘴#3附近',
     'REVIEWING', '11111111-1111-1111-1111-111111111102', '11111111-1111-1111-1111-111111111102',
     'GE90燃烧室例行C检，发现疑似热斑'),
    ('33333333-3333-3333-3333-333333333303', 'BS-2026-0003', '22222222-2222-2222-2222-222222222203',
     '2026-06-20', '故障孔探', 'Olympus IV0620C', '低压压气机(LPC)', '第3级', '转子叶片',
     'CLEAR', '11111111-1111-1111-1111-111111111103', '11111111-1111-1111-1111-111111111101',
     'PW1000G LPC第3级异物吸入排查，结果正常')
ON CONFLICT (case_number) DO NOTHING;

-- ============================================================
-- 7. 行级安全策略 (RLS) 示例
-- ============================================================

ALTER TABLE inspection_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE defect_annotation ENABLE ROW LEVEL SECURITY;

-- 判读员可操作分配给自己的待判读工单
CREATE POLICY inspector_case_access ON inspection_case
    FOR ALL
    USING (
        (current_setting('app.current_role', true) = 'INSPECTOR'
         AND inspector_id::text = current_setting('app.current_user_id', true))
        OR current_setting('app.current_role', true) IN ('REVIEWER', 'RELEASER', 'ADMIN')
    );

-- 标注可见性控制
CREATE POLICY annotation_access ON defect_annotation
    FOR SELECT
    USING (true);

-- ============================================================
-- 8. 权限矩阵视图 (方便查询)
-- ============================================================

CREATE OR REPLACE VIEW v_role_permissions AS
SELECT
    r.role_name,
    r.resource,
    r.action,
    r.description
FROM (VALUES
    ('INSPECTOR', 'inspection_case', 'create',   '创建孔探工单'),
    ('INSPECTOR', 'inspection_case', 'read',     '查看分配的工单'),
    ('INSPECTOR', 'inspection_case', 'submit',   '提交判读 (PENDING→REVIEWING)'),
    ('INSPECTOR', 'annotation',      'create',   '创建缺陷标注'),
    ('INSPECTOR', 'annotation',      'update',   '更新缺陷标注'),
    ('INSPECTOR', 'annotation',      'delete',   '删除缺陷标注'),
    ('INSPECTOR', 'image',           'upload',   '上传孔探图像'),
    ('INSPECTOR', 'image',           'tile',     '生成瓦片'),
    ('REVIEWER',  'inspection_case', 'read',     '查看所有待复核工单'),
    ('REVIEWER',  'inspection_case', 'approve',  '复核通过 (REVIEWING→REPAIR/CLEAR)'),
    ('REVIEWER',  'inspection_case', 'reject',   '复核退回 (REVIEWING→PENDING)'),
    ('REVIEWER',  'annotation',      'read',     '查看所有标注'),
    ('REVIEWER',  'workflow',        'comment',  '添加复核评论'),
    ('RELEASER',  'inspection_case', 'read',     '查看所有已判定工单'),
    ('RELEASER',  'inspection_case', 'release',  '签发放行记录'),
    ('RELEASER',  'inspection_case', 'close',    '关闭工单 (REPAIR/CLEAR→CLOSED)'),
    ('RELEASER',  'certificate',     'generate', '生成放行证书'),
    ('ADMIN',     'user',            'manage',   '用户管理'),
    ('ADMIN',     'inspection_case', 'force_close', '强制关闭任何工单'),
    ('ADMIN',     'system',          'config',   '系统配置管理')
) AS r(role_name, resource, action, description);
