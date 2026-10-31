export class ErroHttp extends Error {
  readonly status: number;
  readonly codigo: string;

  constructor(status: number, codigo: string) {
    super(codigo);
    this.name = 'ErroHttp';
    this.status = status;
    this.codigo = codigo;
  }
}
