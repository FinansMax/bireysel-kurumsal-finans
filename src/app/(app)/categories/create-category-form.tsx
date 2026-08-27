"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Yeni kategori oluşturma formu (Issue #50).
 *
 * Mevcut `POST /api/tenants/:tenantId/categories`'e gerçek HTTP isteği atar;
 * `createCategory()` servisi doğrudan çağrılMAZ — yetkilendirme
 * (`requirePermission(MANAGE_CATEGORIES)`) ve aktif tenant tutarlılık kontrolü route
 * seviyesindedir (bkz. `create-account-form.tsx`'teki aynı gerekçe).
 *
 * `tenantId` prop olarak SUNUCUDAN gelir (aktif tenant); istemcinin uydurduğu bir değer
 * değildir. Uydurulsaydı bile backend aktif tenant ile eşleşmeyen bir tenantId'yi 403'le
 * reddederdi (bkz. `requirePermission()` → `expectedTenantId`).
 */

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: kategori adı 2-100 karakter olmalı.";
    case 403:
      return "Bu çalışma alanında kategori oluşturma yetkiniz yok.";
    case 409:
      // Mesaj TÜRÜ de söyler: benzersizlik tenant + tür + isim üzerindendir (bkz.
      // prisma/schema.prisma'daki `Category` notu). "Bu isimde bir kategori zaten var"
      // demek yanıltıcı olurdu — kullanıcı aynı ismi diğer türde kullanabilir.
      return "Bu türde bu isimde bir kategori zaten var. Farklı bir ad deneyin.";
    default:
      return "Kategori oluşturulamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

const CATEGORY_TYPES = [
  { value: "EXPENSE", label: "Gider" },
  { value: "INCOME", label: "Gelir" },
] as const;

export function CreateCategoryForm({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  // Varsayılan "Gider": kayıtların ezici çoğunluğu gider tarafındadır, varsayılanı doğru
  // tarafa koymak formdaki en sık tekrar eden tıklamayı ortadan kaldırır.
  const [type, setType] = useState<string>("EXPENSE");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/tenants/${tenantId}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
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
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="max-w-sm space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Yeni kategori</h2>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
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
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Tür
          </label>
          <select
            id="category-type"
            name="category-type"
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
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
          {pending ? "Oluşturuluyor…" : "Kategori oluştur"}
        </SubmitButton>
      </form>
    </div>
  );
}
