export function GuideLessonContent({
  id,
  summary,
  points,
}: {
  id: string;
  summary: string;
  points?: readonly string[];
}) {
  return (
    <div className="quick-start-guide__body" id={id}>
      <p className="quick-start-guide__summary">{summary}</p>
      {points && points.length > 0 && (
        <ul className="quick-start-guide__points">
          {points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function GuideLessonProgress({ current, total, chapter }: { current: number; total: number; chapter: string }) {
  const percentage = total > 0 ? Math.min(100, Math.max(0, (current / total) * 100)) : 0;
  return (
    <div
      className="quick-start-guide__progress"
      role="progressbar"
      aria-label={`${chapter}: etapa ${current} de ${total}`}
      aria-valuemin={1}
      aria-valuemax={total}
      aria-valuenow={current}
    >
      <div className="quick-start-guide__progress-label">
        <span>{chapter}</span>
        <span>
          {current} de {total}
        </span>
      </div>
      <span className="quick-start-guide__progress-track" aria-hidden="true">
        <i style={{ width: `${percentage}%` }} />
      </span>
    </div>
  );
}
