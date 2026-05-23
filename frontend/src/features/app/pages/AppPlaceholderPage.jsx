export function AppPlaceholderPage({ title, description }) {
  return (
    <section className="rounded-lg border border-dashed border-border bg-background p-6">
      <p className="su-type-meta text-muted-foreground">Halaman</p>
      <h2 className="su-type-section-title mt-2 text-foreground">{title}</h2>
      <p className="su-type-helper mt-2 max-w-2xl text-muted-foreground">{description}</p>
    </section>
  );
}
