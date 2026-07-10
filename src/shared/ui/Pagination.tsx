import { useMemo } from "react";
import { Select } from "./Select";

export const PAGINATION_SIZES = [10, 25, 50] as const;
export type PaginationSize = (typeof PAGINATION_SIZES)[number];

type PageToken = number | "ellipsis-left" | "ellipsis-right";

type PaginationProps = {
  page: number;
  pageSize: PaginationSize;
  totalCount: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PaginationSize) => void;
  itemLabel?: string;
  ariaLabel?: string;
};

function pageTokens(page: number, pageCount: number): PageToken[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, index) => index);

  const tokens: PageToken[] = [0];
  const start = Math.max(1, page - 1);
  const end = Math.min(pageCount - 2, page + 1);
  if (start > 1) tokens.push("ellipsis-left");
  for (let index = start; index <= end; index += 1) tokens.push(index);
  if (end < pageCount - 2) tokens.push("ellipsis-right");
  tokens.push(pageCount - 1);
  return tokens;
}

export function Pagination({
  page,
  pageSize,
  totalCount,
  onPageChange,
  onPageSizeChange,
  itemLabel = "itens",
  ariaLabel = "Paginação",
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(totalCount / pageSize));
  const currentPage = Math.min(Math.max(page, 0), pageCount - 1);
  const firstItem = totalCount === 0 ? 0 : currentPage * pageSize + 1;
  const lastItem = Math.min(totalCount, (currentPage + 1) * pageSize);
  const tokens = useMemo(() => pageTokens(currentPage, pageCount), [currentPage, pageCount]);

  if (totalCount === 0) return null;

  return (
    <nav className="pagination" aria-label={ariaLabel}>
      <span className="pagination__summary">
        {firstItem}–{lastItem} de {totalCount} {itemLabel}
      </span>
      <div className="pagination__controls">
        <button
          className="secondary pagination__button pagination__edge"
          type="button"
          aria-label="Primeira página"
          title="Primeira página"
          disabled={currentPage === 0}
          onClick={() => onPageChange(0)}
        >
          <span className="pagination__glyph" aria-hidden="true">
            «
          </span>
        </button>
        <button
          className="secondary pagination__button pagination__edge"
          type="button"
          aria-label="Página anterior"
          title="Página anterior"
          disabled={currentPage === 0}
          onClick={() => onPageChange(currentPage - 1)}
        >
          <span className="pagination__glyph" aria-hidden="true">
            ‹
          </span>
        </button>
        <div className="pagination__pages">
          {tokens.map((token) =>
            typeof token === "number" ? (
              <button
                className="secondary pagination__button"
                type="button"
                key={token}
                aria-current={token === currentPage ? "page" : undefined}
                aria-label={`Ir para a página ${token + 1}`}
                onClick={() => onPageChange(token)}
              >
                {token + 1}
              </button>
            ) : (
              <span className="pagination__ellipsis" aria-hidden="true" key={token}>
                …
              </span>
            ),
          )}
        </div>
        <button
          className="secondary pagination__button pagination__edge"
          type="button"
          aria-label="Próxima página"
          title="Próxima página"
          disabled={currentPage === pageCount - 1}
          onClick={() => onPageChange(currentPage + 1)}
        >
          <span className="pagination__glyph" aria-hidden="true">
            ›
          </span>
        </button>
        <button
          className="secondary pagination__button pagination__edge"
          type="button"
          aria-label="Última página"
          title="Última página"
          disabled={currentPage === pageCount - 1}
          onClick={() => onPageChange(pageCount - 1)}
        >
          <span className="pagination__glyph" aria-hidden="true">
            »
          </span>
        </button>
      </div>
      <label className="pagination__size">
        <span>Por página</span>
        <Select
          value={pageSize}
          ariaLabel="Itens por página"
          onChange={(value) => onPageSizeChange(Number(value) as PaginationSize)}
          options={PAGINATION_SIZES.map((size) => ({ value: size, label: size }))}
        />
      </label>
    </nav>
  );
}
