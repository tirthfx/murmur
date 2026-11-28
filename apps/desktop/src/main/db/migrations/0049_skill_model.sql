-- Skills (NT-15): which local model writes a custom Skill's output. Built-in Skills use the
-- fast one.

-- migrate:up
ALTER TABLE skills ADD COLUMN model TEXT NOT NULL DEFAULT 'fast' CHECK (model IN ('fast', 'quality'));
ALTER TABLE skill_versions ADD COLUMN model TEXT NOT NULL DEFAULT 'fast' CHECK (model IN ('fast', 'quality'));

-- migrate:down
ALTER TABLE skill_versions DROP COLUMN model;
ALTER TABLE skills DROP COLUMN model;
