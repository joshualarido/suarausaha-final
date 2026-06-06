import { useEffect, useMemo, useState } from "react";
import { ChefHat, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LoadingState } from "@/features/app/components/LoadingState";
import { ApiClientError } from "@/lib/api-client";
import { createMenuItem, getMenuItems, removeMenuItem, updateMenuItem } from "@/features/catalog/menu-items.api";

const emptyDraft = {
  name: "",
  aliasesText: "",
  defaultPriceText: "",
};

function normalizeError(error, fallback) {
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message || fallback;
  }
  return fallback;
}

function aliasesToText(aliases) {
  return Array.isArray(aliases) ? aliases.join(", ") : "";
}

function textToAliases(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function toDraft(menuItem) {
  return {
    name: menuItem.name ?? "",
    aliasesText: aliasesToText(menuItem.aliases),
    defaultPriceText: menuItem.defaultPrice === null || menuItem.defaultPrice === undefined ? "" : String(menuItem.defaultPrice),
  };
}

function parsePrice(value) {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const numeric = Number(trimmed.replace(/[^\d]/g, ""));
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function toPayload(draft) {
  return {
    name: draft.name.trim(),
    aliases: textToAliases(draft.aliasesText),
    defaultPrice: parsePrice(draft.defaultPriceText),
  };
}

export function AppCatalogPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [menuItems, setMenuItems] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [newDraft, setNewDraft] = useState(emptyDraft);
  const [pageError, setPageError] = useState("");
  const [message, setMessage] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [savingItemId, setSavingItemId] = useState("");
  const [removingItemId, setRemovingItemId] = useState("");
  const [pendingDeleteItemId, setPendingDeleteItemId] = useState("");

  const currencyFormatter = useMemo(
    () => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }),
    [],
  );

  useEffect(() => {
    let mounted = true;

    async function loadMenuItems() {
      setIsLoading(true);
      setPageError("");

      try {
        const payload = await getMenuItems();
        if (!mounted) return;

        const items = Array.isArray(payload?.data) ? payload.data : [];
        setMenuItems(items);
        setDrafts(
          items.reduce((result, item) => {
            result[item.id] = toDraft(item);
            return result;
          }, {}),
        );
      } catch (error) {
        if (!mounted) return;
        setPageError(normalizeError(error, "Gagal memuat katalog."));
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }

    loadMenuItems();

    return () => {
      mounted = false;
    };
  }, []);

  function setDraftValue(menuItemId, field, value) {
    setDrafts((previous) => ({
      ...previous,
      [menuItemId]: {
        ...previous[menuItemId],
        [field]: value,
      },
    }));
  }

  function setNewDraftValue(field, value) {
    setNewDraft((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  async function handleAddMenuItem() {
    const payload = toPayload(newDraft);

    if (!payload.name) {
      setMessage("Nama item wajib diisi.");
      return;
    }

    if (newDraft.defaultPriceText.trim() && payload.defaultPrice === null) {
      setMessage("Harga item harus berupa angka lebih dari 0.");
      return;
    }

    setIsAdding(true);
    setMessage("");

    try {
      const response = await createMenuItem(payload);
      const created = response?.data;
      if (!created) {
        throw new Error("Item katalog gagal dibuat.");
      }

      setMenuItems((previous) => [...previous, created]);
      setDrafts((previous) => ({
        ...previous,
        [created.id]: toDraft(created),
      }));
      setNewDraft(emptyDraft);
      setMessage("Item katalog berhasil ditambahkan.");
    } catch (error) {
      setMessage(normalizeError(error, "Gagal menambahkan item katalog."));
    } finally {
      setIsAdding(false);
    }
  }

  async function handleSaveMenuItem(menuItemId) {
    const draft = drafts[menuItemId] ?? emptyDraft;
    const payload = toPayload(draft);

    if (!payload.name) {
      setMessage("Nama item wajib diisi.");
      return;
    }

    if (draft.defaultPriceText.trim() && payload.defaultPrice === null) {
      setMessage("Harga item harus berupa angka lebih dari 0.");
      return;
    }

    setSavingItemId(menuItemId);
    setMessage("");

    try {
      const response = await updateMenuItem(menuItemId, payload);
      const updated = response?.data;
      if (!updated) {
        throw new Error("Item katalog gagal diperbarui.");
      }

      setMenuItems((previous) => previous.map((item) => (item.id === menuItemId ? updated : item)));
      setDrafts((previous) => ({
        ...previous,
        [menuItemId]: toDraft(updated),
      }));
      setMessage("Item katalog berhasil diperbarui.");
    } catch (error) {
      setMessage(normalizeError(error, "Gagal menyimpan item katalog."));
    } finally {
      setSavingItemId("");
    }
  }

  async function handleRemoveMenuItem(menuItemId) {
    setRemovingItemId(menuItemId);
    setMessage("");

    try {
      await removeMenuItem(menuItemId);
      setMenuItems((previous) => previous.filter((item) => item.id !== menuItemId));
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[menuItemId];
        return next;
      });
      setMessage("Item katalog berhasil dihapus dari daftar aktif.");
      return true;
    } catch (error) {
      setMessage(normalizeError(error, "Gagal menghapus item katalog."));
      return false;
    } finally {
      setRemovingItemId("");
    }
  }

  if (isLoading) {
    return <LoadingState title="Memuat katalog..." description="Mohon tunggu sebentar." />;
  }

  return (
    <div className="grid gap-6">
      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary text-primary">
            <ChefHat aria-hidden className="h-5 w-5" />
          </div>
          <div>
            <h2 className="su-type-section-title text-foreground">Katalog usaha</h2>
            <p className="su-type-helper text-muted-foreground">Daftar ini membantu chat mengenali produk atau jasa kamu.</p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_minmax(12rem,1fr)_auto] lg:items-end">
          <label className="grid gap-2">
            <span className="su-type-ui text-foreground">Nama item</span>
            <input
              type="text"
              value={newDraft.name}
              onChange={(event) => setNewDraftValue("name", event.target.value)}
              placeholder="Contoh: Ayam Geprek / Jasa Cuci"
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <label className="grid gap-2">
            <span className="su-type-ui text-foreground">Harga</span>
            <input
              type="text"
              inputMode="numeric"
              value={newDraft.defaultPriceText}
              onChange={(event) => setNewDraftValue("defaultPriceText", event.target.value)}
              placeholder="15000"
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <label className="grid gap-2">
            <span className="su-type-ui text-foreground">Alias</span>
            <input
              type="text"
              value={newDraft.aliasesText}
              onChange={(event) => setNewDraftValue("aliasesText", event.target.value)}
              placeholder="geprek, ayam"
              className="su-type-field h-11 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
            />
          </label>

          <Button type="button" onClick={handleAddMenuItem} disabled={isAdding} className="h-11 gap-2 px-4">
            <Plus aria-hidden className="h-4 w-4" />
            {isAdding ? "Menambahkan..." : "Tambah"}
          </Button>
        </div>

        {message ? <p className="su-type-helper mt-3 text-muted-foreground">{message}</p> : null}
      </section>

      <section className="motion-enter-up rounded-lg border border-border bg-card p-6 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="su-type-section-title text-foreground">Daftar katalog aktif</h2>
            <p className="su-type-helper text-muted-foreground">Item aktif akan masuk ke konteks parser.</p>
          </div>
          <span className="su-type-meta rounded-full bg-secondary px-3 py-1 text-primary">{menuItems.length} item</span>
        </div>

        <div className="mt-5 grid gap-4">
          {menuItems.length === 0 ? (
            <div className="rounded-md border border-dashed border-border bg-background p-5">
              <p className="su-type-helper text-muted-foreground">Belum ada item katalog aktif.</p>
            </div>
          ) : null}

          {menuItems.map((item) => {
            const draft = drafts[item.id] ?? toDraft(item);

            return (
              <article key={item.id} className="group rounded-md border border-border bg-background p-4">
                <div className="grid gap-3 lg:grid-cols-[minmax(12rem,1.4fr)_minmax(10rem,1fr)_minmax(12rem,1fr)_auto_auto] lg:items-end">
                  <label className="grid gap-2">
                    <span className="su-type-ui text-foreground">Nama item</span>
                    <input
                      type="text"
                      value={draft.name}
                      onChange={(event) => setDraftValue(item.id, "name", event.target.value)}
                      className="su-type-field h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="su-type-ui text-foreground">Harga</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={draft.defaultPriceText}
                      onChange={(event) => setDraftValue(item.id, "defaultPriceText", event.target.value)}
                      className="su-type-field h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </label>

                  <label className="grid gap-2">
                    <span className="su-type-ui text-foreground">Alias</span>
                    <input
                      type="text"
                      value={draft.aliasesText}
                      onChange={(event) => setDraftValue(item.id, "aliasesText", event.target.value)}
                      className="su-type-field h-11 rounded-md border border-border bg-card px-3 text-foreground outline-none focus:ring-2 focus:ring-ring/20"
                    />
                  </label>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={savingItemId === item.id || removingItemId === item.id}
                    onClick={() => handleSaveMenuItem(item.id)}
                    className="h-11 gap-2 px-4"
                  >
                    <Save aria-hidden className="h-4 w-4" />
                    {savingItemId === item.id ? "Menyimpan..." : "Simpan"}
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={savingItemId === item.id || removingItemId === item.id}
                    onClick={() => setPendingDeleteItemId(item.id)}
                    className="h-11 gap-2 px-4 text-danger hover:text-danger"
                  >
                    <Trash2 aria-hidden className="h-4 w-4" />
                    {removingItemId === item.id ? "Menghapus..." : "Hapus"}
                  </Button>

                </div>

                <p className="su-type-helper mt-3 text-muted-foreground">
                Harga konteks:{" "}
                  <span className="font-semibold text-foreground">
                    {item.defaultPrice ? currencyFormatter.format(item.defaultPrice) : "Belum diisi"}
                  </span>
                </p>
              </article>
            );
          })}
        </div>
      </section>

      {pageError ? (
        <section className="motion-enter-up rounded-lg border border-danger/40 bg-card p-4">
          <p className="su-type-helper text-danger">{pageError}</p>
        </section>
      ) : null}

      {pendingDeleteItemId ? (
        <div className="motion-enter-up fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4">
          <section className="motion-enter-scale w-full max-w-md rounded-lg border border-border bg-card p-5 shadow-xl">
            <h2 className="su-type-ui text-foreground">Hapus item katalog?</h2>
            <p className="su-type-helper mt-2 text-muted-foreground">
              Item ini akan hilang dari daftar aktif dan tidak dipakai sebagai konteks chat.
            </p>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(removingItemId)}
                onClick={() => setPendingDeleteItemId("")}
                className="h-11 px-4"
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={Boolean(removingItemId)}
                className="h-11 px-4"
                onClick={async () => {
                  const isSuccess = await handleRemoveMenuItem(pendingDeleteItemId);
                  if (isSuccess) {
                    setPendingDeleteItemId("");
                  }
                }}
              >
                {removingItemId === pendingDeleteItemId ? "Menghapus..." : "Ya, hapus"}
              </Button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
