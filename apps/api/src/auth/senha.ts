import { hash, verify } from '@node-rs/argon2';

/** Argon2id (padrão da biblioteca) com salt aleatório. */
export const hashSenha = (senha: string): Promise<string> => hash(senha);
export const conferirSenha = (hashSalvo: string, senha: string): Promise<boolean> => verify(hashSalvo, senha);
