type Props = {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Ex.: singular "imagem", plural "imagens" */
  nounSingular?: string;
  nounPlural?: string;
};

/**
 * Controlo de paginação (texto + Anterior / Seguinte) para listas em React.
 */
export function AdminPagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  nounSingular = "item",
  nounPlural = "itens",
}: Props) {
  if (total === 0) {
    return null;
  }

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);
  const noun = total === 1 ? nounSingular : nounPlural;

  if (total <= pageSize) {
    return (
      <p className="text-xs text-slate-500" role="status">
        {total} {noun}
      </p>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 bg-slate-50/50 px-1 py-3 text-sm text-slate-700 sm:px-2"
      role="navigation"
      aria-label="Paginação da lista"
    >
      <p className="text-xs text-slate-600">
        Mostrando {start}–{end} de {total}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Página anterior"
        >
          Anterior
        </button>
        <span className="px-2 text-xs text-slate-600">
          Página {page + 1} de {pageCount}
        </span>
        <button
          type="button"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Página seguinte"
        >
          Seguinte
        </button>
      </div>
    </div>
  );
}
