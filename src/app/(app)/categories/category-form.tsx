"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FIELD_CLASS, FormError, LABEL_CLASS, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Kategori oluşturma ve düzenleme formu (Issue #50 + #130).
 *
 * Mevcut `POST /api/tenants/:tenantId/categories` veya `PATCH .../categories/:categoryId`'e
 * gerçek HTTP isteği atar; servis fonksiyonu doğrudan çağrılMAZ — yetkilendirme
 * (`requirePermission(MANAGE_CATEGORIES)`) ve aktif tenant tutarlılık kontrolü route
 * seviyesindedir (bkz. `account-form.tsx`'teki aynı gerekçe).
 *
 * TEK BİLEŞEN, İKİ MOD: `category` prop'u verilirse düzenleme, verilmezse oluşturma.
 *
 * `tenantId` prop olarak SUNUCUDAN gelir (aktif tenant); istemcinin uydurduğu bir değer
 * değildir. Uydurulsaydı bile backend aktif tenant ile eşleşmeyen bir tenantId'yi 403'le
 * reddederdi (bkz. `requirePermission()` → `expectedTenantId`).
 */

export type EditableCategory = {
  id: string;
  name: string;
  type: string;
};

function messageForStatus(status: number, editing: boolean): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: kategori adı 2-100 karakter olmalı.";
    case 403:
      return editing
        ? "Bu çalışma alanında kategori düzenleme yetkiniz yok."
        : "Bu çalışma alanında kategori oluşturma yetkiniz yok.";
    case 404:
      return "Bu kategori artık mevcut değil. Sayfayı yenileyin.";
    case 409:
      // Mesaj TÜRÜ de söyler: benzersizlik tenant + tür + isim üzerindendir (bkz.
      // prisma/schema.prisma'daki `Category` notu). "Bu isimde bir kategori zaten var"
      // demek yanıltıcı olurdu — kullanıcı aynı ismi diğer türde kullanabilir. Düzenlemede
      // bu, çoğunlukla TÜRÜ değiştirip karşı tarafta aynı isme çarpmaktan gelir (#49).
      return "Bu türde bu isimde bir kategori zaten var. Farklı bir ad deneyin.";
    default:
      return editing
        ? "Kategori güncellenemedi. Lütfen daha sonra tekrar deneyin."
        : "Kategori oluşturulamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

const CATEGORY_TYPES = [
  { value: "EXPENSE", label: "Gider" },
  { value: "INCOME", label: "Gelir" },
] as const;

export function CategoryForm({
  tenantId,
  category,
}: {
  tenantId: string;
  /** Verilirse düzenleme modu. */
  category?: EditableCategory;
}) {
  const router = useRouter();
  const editing = category !== undefined;
  const [name, setName] = useState(category?.name ?? "");
  // Varsayılan "Gider": kayıtların ezici çoğunluğu gider tarafındadır, varsayılanı doğru
  // tarafa koymak formdaki en sık tekrar eden tıklamayı ortadan kaldırır.
  const [type, setType] = useState<string>(category?.type ?? "EXPENSE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(
        editing
          ? `/api/tenants/${tenantId}/categories/${category.id}`
          : `/api/tenants/${tenantId}/categories`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, type }),
        },
      );

      if (!response.ok) {
        setError(messageForStatus(response.status, editing));
        return;
      }

      if (editing) {
        // Düzenleme bitince listeye dönülür; `?edit=` URL'de kalırsa kullanıcı kaydettiği
        // hâlde hâlâ formda duruyormuş gibi görünürdü.
        router.push("/categories");
        router.refresh();
        return;
      }

      setName("");
      // Tür SIFIRLANMAZ: kullanıcı genellikle arka arkaya aynı taraftan birkaç kategori
      // girer; seçimi her kayıttan sonra "Gider"e döndürmek onu her seferinde yeniden
      // seçmeye zorlardı.
      // Liste sunucuda render edilir; `refresh()` sunucu bileşenini yeni veriyle yeniden
      // çalıştırır (aktif tenant değişmediği için tam sayfa yüklemeye gerek yok).
      router.refresh();
    } catch {
      setError(messageForStatus(0, editing));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm space-y-4 rounded-panel border border-line bg-surface p-5 shadow-subtle">
      <h2 className="text-sm font-semibold text-strong">
        {editing ? "Kategoriyi düzenle" : "Yeni kategori"}
      </h2>

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label={editing ? "Kategoriyi düzenle" : "Yeni kategori"}
        noValidate
      >
        <TextField
          id="category-name"
          label="Kategori adı"
          type="text"
          autoComplete="off"
          value={name}
          onChange={setName}
          disabled={pending}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="category-type"
            className={LABEL_CLASS}
          >
            Tür
          </label>
          <select
            id="category-type"
            name="category-type"
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value)}
            className={FIELD_CLASS}
          >
            {CATEGORY_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <FormError message={error} />

        <SubmitButton pending={pending}>
          {pending
            ? editing
              ? "Kaydediliyor…"
              : "Oluşturuluyor…"
            : editing
              ? "Değişiklikleri kaydet"
              : "Kategori oluştur"}
        </SubmitButton>
      </form>
    </div>
  );
}
