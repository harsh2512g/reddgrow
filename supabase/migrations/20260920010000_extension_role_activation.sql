-- The project-local server uses the existing guarded postgres connection and explicitly
-- narrows every extension API transaction to this NOLOGIN role. PostgreSQL does not
-- automatically grant SET authority to a newly-created role's creator.
grant threadsignal_extension_api to postgres with inherit false, set true;
