/**
 * Paginação client-side para tabelas admin cujo `tbody` pode ser repovoado (ex.: lista do GitHub).
 */
export type InitAdminTablePaginationOptions = {
  tbodyId: string;
  navId: string;
  /** @default 10 */
  pageSize?: number;
};

const DEFAULT_SIZE = 10;

export function initAdminTablePagination(options: InitAdminTablePaginationOptions): void {
  const tbody = document.getElementById(options.tbodyId);
  const nav = document.getElementById(options.navId);
  if (!tbody || !nav) return;

  const pageSize = options.pageSize && options.pageSize > 0 ? options.pageSize : DEFAULT_SIZE;
  let currentPage = 0;

  function rowCount(): number {
    return tbody.querySelectorAll("tr").length;
  }

  function pageCount(): number {
    const n = rowCount();
    return Math.max(1, Math.ceil(n / pageSize));
  }

  function apply(): void {
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const total = rows.length;
    const pc = Math.max(1, Math.ceil(total / pageSize) || 1);
    if (currentPage >= pc) currentPage = Math.max(0, pc - 1);

    const start = currentPage * pageSize;
    const end = Math.min(start + pageSize, total);

    rows.forEach((tr, i) => {
      const show = i >= start && i < end;
      tr.classList.toggle("hidden", !show);
      if (show) tr.removeAttribute("hidden");
      else tr.setAttribute("hidden", "");
    });

    nav.textContent = "";
    if (total === 0) {
      nav.setAttribute("hidden", "");
      return;
    }
    nav.removeAttribute("hidden");

    if (total <= pageSize) {
      const p = document.createElement("p");
      p.className = "text-xs text-zinc-500";
      p.textContent = `${total} ${total === 1 ? "item" : "itens"}`;
      nav.appendChild(p);
      return;
    }

    const wrap = document.createElement("div");
    wrap.className = "flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/80 bg-zinc-50/50 px-4 py-3 text-sm text-zinc-700";
    wrap.setAttribute("role", "navigation");
    wrap.setAttribute("aria-label", "Paginação da lista");

    const info = document.createElement("p");
    info.className = "text-xs text-zinc-600";
    info.textContent = `Mostrando ${start + 1}–${end} de ${total}`;

    const controls = document.createElement("div");
    controls.className = "flex flex-wrap items-center gap-2";

    const prev = document.createElement("button");
    prev.type = "button";
    prev.className =
      "rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40";
    prev.textContent = "Anterior";
    prev.disabled = currentPage <= 0;
    prev.setAttribute("aria-label", "Página anterior");

    const pageLabel = document.createElement("span");
    pageLabel.className = "px-2 text-xs text-zinc-600";
    pageLabel.textContent = `Página ${currentPage + 1} de ${pc}`;

    const next = document.createElement("button");
    next.type = "button";
    next.className = prev.className;
    next.textContent = "Seguinte";
    next.disabled = currentPage >= pc - 1;
    next.setAttribute("aria-label", "Página seguinte");

    prev.addEventListener("click", () => {
      if (currentPage > 0) {
        currentPage -= 1;
        apply();
      }
    });
    next.addEventListener("click", () => {
      if (currentPage < pc - 1) {
        currentPage += 1;
        apply();
      }
    });

    controls.appendChild(prev);
    controls.appendChild(pageLabel);
    controls.appendChild(next);
    wrap.appendChild(info);
    wrap.appendChild(controls);
    nav.appendChild(wrap);
  }

  const mo = new MutationObserver(() => {
    const n = rowCount();
    const pc = Math.max(1, Math.ceil(n / pageSize) || 1);
    if (currentPage >= pc) currentPage = Math.max(0, pc - 1);
    apply();
  });
  mo.observe(tbody, { childList: true });
  apply();
}
