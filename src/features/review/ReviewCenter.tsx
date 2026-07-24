import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, CircleDollarSign, CreditCard, ListChecks, Tags, WalletCards } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../shared/api";
import { money, shortDate } from "../../shared/format";
import { ErrorState, LoadingState } from "../../shared/ui/AsyncState";
import { PageHeader } from "../../shared/ui/PageHeader";
import type { DataQualityReview, ReviewItem, ReviewSection } from "../../shared/types";
import "./review-center.css";

export type { DataQualityReview, ReviewItem, ReviewSection };

type ReviewLoader = () => Promise<DataQualityReview>;

const loadReviewFromApi: ReviewLoader = () => api.dataQualityReview();

const sectionDefinitions = [
  {
    key: "uncategorized",
    title: "Escolher categorias",
    explanation: "Ajuda seus relatórios e seu orçamento a ficarem corretos.",
    icon: Tags,
  },
  {
    key: "pendingTransactions",
    title: "Confirmar lançamentos",
    explanation: "Confira o que ainda não entrou no saldo realizado.",
    icon: ListChecks,
  },
  {
    key: "accountReconciliations",
    title: "Conferir saldos",
    explanation: "Compare o saldo do Lumen com o saldo mostrado pela conta.",
    icon: WalletCards,
  },
  {
    key: "cardPaymentReconciliations",
    title: "Conciliar cartões",
    explanation: "Ligue o pagamento à fatura e ao lançamento da conta.",
    icon: CreditCard,
  },
] as const;

export function ReviewCenter({ loadReview = loadReviewFromApi }: { loadReview?: ReviewLoader }) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["data-quality-review"],
    queryFn: loadReview,
  });

  return (
    <section className="review-center">
      <PageHeader
        eyebrow="ORGANIZAR"
        title="Pendências"
        description="Pequenas conferências para manter suas finanças em ordem."
      />

      {isLoading && <LoadingState variant="panel" label="Procurando o que precisa da sua atenção…" />}
      {isError && (
        <ErrorState
          message="Não foi possível verificar as pendências."
          onRetry={() => {
            void refetch();
          }}
        />
      )}
      {data && data.totalCount === 0 && (
        <article className="panel review-center__complete" role="status">
          <CheckCircle2 size={28} aria-hidden="true" />
          <div>
            <h2>Tudo em ordem</h2>
            <p className="muted">Não há nenhuma conferência esperando por você.</p>
          </div>
        </article>
      )}
      {data && data.totalCount > 0 && (
        <>
          <div className="review-center__summary" aria-label="Resumo das pendências">
            <CircleDollarSign size={24} aria-hidden="true" />
            <div>
              <strong>
                {data.totalCount} {data.totalCount === 1 ? "pendência encontrada" : "pendências encontradas"}
              </strong>
              <span>Comece por qualquer bloco. Você não precisa resolver tudo de uma vez.</span>
            </div>
          </div>
          <div className="review-center__grid">
            {sectionDefinitions.map(({ key, title, explanation, icon: Icon }) => {
              const reviewSection = data[key];
              return (
                <article className="panel review-section" key={key}>
                  <header className="review-section__header">
                    <span className="review-section__icon">
                      <Icon size={21} aria-hidden="true" />
                    </span>
                    <div>
                      <h2>{title}</h2>
                      <p>{explanation}</p>
                    </div>
                    <span className="badge" aria-label={`${reviewSection.totalCount} pendências`}>
                      {reviewSection.totalCount}
                    </span>
                  </header>
                  {reviewSection.totalCount === 0 ? (
                    <p className="review-section__empty">
                      <CheckCircle2 size={18} aria-hidden="true" /> Nenhuma pendência aqui
                    </p>
                  ) : (
                    <>
                      <ul className="review-section__items">
                        {reviewSection.items.map((item) => (
                          <li key={item.id}>
                            <div className="review-item__main">
                              <strong>{item.title}</strong>
                              <span>{item.description}</span>
                              {(item.date || item.amountInCents !== undefined) && (
                                <small>
                                  {item.date && shortDate(item.date)}
                                  {item.date && item.amountInCents !== undefined && " · "}
                                  {item.amountInCents !== undefined && money(item.amountInCents)}
                                </small>
                              )}
                            </div>
                            <Link className="secondary review-item__action" to={item.actionPath}>
                              {item.actionLabel}
                            </Link>
                          </li>
                        ))}
                      </ul>
                      {reviewSection.totalCount > reviewSection.items.length && (
                        <p className="review-section__remaining">
                          Mais {reviewSection.totalCount - reviewSection.items.length} para ver depois
                        </p>
                      )}
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
