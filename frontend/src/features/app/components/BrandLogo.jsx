function LogoMark() {
  return (
    <div
      aria-hidden
      className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm"
    >
      <span className="flex h-5 items-end gap-1">
        <span className="block h-2 w-1.5 rounded-full bg-current" />
        <span className="block h-3.5 w-1.5 rounded-full bg-current" />
        <span className="block h-5 w-1.5 rounded-full bg-current" />
      </span>
    </div>
  );
}

export function BrandLogo() {
  return (
    <div className="flex items-center gap-3">
      <LogoMark />
      <span className="text-xl font-bold text-primary">SuaraUsaha</span>
    </div>
  );
}
