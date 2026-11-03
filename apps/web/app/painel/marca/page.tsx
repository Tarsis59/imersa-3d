import { apiNaPagina } from '@/lib/sessao';
import { buscarMarca } from './actions';
import { FormularioMarca } from './formulario';

/** Marca da incorporadora (Plano 12b, item 11): logo, cor primária e fonte, aplicados no portal, no estande e na Vitrine. */
export default async function PaginaMarca() {
  const volta = '/painel/marca';
  const [projetos, marca] = await Promise.all([apiNaPagina<Array<{ id: string; nome: string }>>('/projetos', volta), buscarMarca()]);
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-bold">Marca da incorporadora</h1>
        <p className="text-sm text-suave">Cada empresa vê a própria marca: aparece no portal do cliente, no estande e aqui na Vitrine.</p>
      </div>
      <FormularioMarca projetos={projetos.status === 200 ? projetos.dados : []} marcaInicial={marca} />
    </div>
  );
}
