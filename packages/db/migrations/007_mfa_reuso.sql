-- MFA: cada código TOTP vale uma vez. Guarda a última janela de 30 s aceita; a mesma ou anteriores são recusadas.
ALTER TABLE users ADD COLUMN mfa_ultimo_contador bigint;
