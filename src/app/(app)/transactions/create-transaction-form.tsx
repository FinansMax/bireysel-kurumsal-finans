"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Yeni işlem kaydetme formu (Issue #54).
 *
 * Mevcut `POST /api/tenants/:tenantId/transactions`'a gerçek HTTP isteği atar;
 * `createTransaction()` servisi doğrudan çağrılMAZ — yetkilendirme
 * (`requirePermission(MANAGE_TRANSACTIONS)`) ve aktif tenant tutarlılık kontrolü route
 * seviyesindedir (bkz. `create-category-form.tsx`'teki aynı gerekçe).
 *
 * `tenantId`, hesap ve kategori listeleri prop olarak SUNUCUDAN gelir; istemcinin uydurduğu
 * değerler değildir. Uydurulsalardı bile backend bunları aktif tenant içinde arar ve
 * eşleşmeyeni `404` ile reddeder (bkz. `requireAccount()` / `requireCategory()`).
 */

type AccountOption = { id: string; name: string; currency: string };
type CategoryOption = { id: string; name: string; type: string };

const TRANSACTION_TYPES = [
  { value: "EXPENSE", label: "Gider" },
  { value: "INCOME", label: "Gelir" },
] as const;

function messageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: tutar 0'dan büyük olmalı ve en fazla 4 ondalık basamak içerebilir (ör. 1250.50).";
    case 403:
      return "Bu çalışma alanında işlem kaydetme yetkiniz yok.";
    case 404:
      // Seçilenler sayfa açıldığından beri silinmiş olabilir. Kullanıcıya "hesap mı kategori
      // mi" diye sormak yerine tek eylem önerilir: sayfayı yenile.
      return "Seçtiğiniz hesap veya kategori artık mevcut değil. Sayfayı yenileyip tekrar deneyin.";
    case 503:
      // Geçici yazma çakışması (#122); iş kuralı ihlali DEĞİLDİR, doğru mesaj "tekrar deneyin".
      return "Kayıt şu anda tamamlanamadı. Lütfen birkaç saniye sonra tekrar deneyin.";
    default:
      return "İşlem kaydedilemedi. Lütfen daha sonra tekrar deneyin.";
  }
}

export function CreateTransactionForm({
  tenantId,
  accounts,
  categories,
  today,
}: {
  tenantId: string;
  accounts: AccountOption[];
  categories: CategoryOption[];
  /**
   * Tarih alanının varsayılanı, `YYYY-MM-DD`.
   *
   * SUNUCUDAN gelir, burada `new Date()` ile HESAPLANMAZ. İki nedeni var: (1) istemcide
   * hesaplanan bir değer sunucu render'ıyla uyuşmazsa hydration uyuşmazlığı doğar — sunucu ile
   * tarayıcının saat dilimi farklıysa gece yarısı civarında tam olarak bu olur; (2) "şimdi"nin
   * kaynağı bu üründe zaten sunucudur (şemadaki `@default(now())`), ikinci bir zaman kaynağı
   * eklemek iki farklı "bugün" üretirdi. Kullanıcı başına saat dilimi yönetimi bu üründe hiç
   * yok ve ayrı bir issue'nun konusu (bkz. README).
   */
  today: string;
}) {
  const router = useRouter();

  // Hesap seçicisi boş bırakılmaz: tek hesabı olan kullanıcı (en yaygın durum) hiç seçim
  // yapmak zorunda kalmaz. Bu bileşen yalnızca en az bir hesap varken render edilir.
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  // Varsayılan "Gider": kayıtların ezici çoğunluğu gider tarafındadır (kategori formundaki
  // aynı karar).
  const [type, setType] = useState<string>("EXPENSE");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [occurredAt, setOccurredAt] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  /**
   * Kategori listesi seçili türe göre süzülür.
   *
   * Süzme İSTEMCİDE yapılır, API'nin `?type` filtresiyle (#49) DEĞİL: sayfa zaten kategorilerin
   * tamamını listeyi çizmek için okumuş durumda, her tür değişiminde ikinci bir istek atmak
   * gereksiz gecikme ve ek hata durumu getirirdi. Sunucu tarafı kontrol yine de asıl koruma:
   * uyumsuz bir kategori gönderilse backend `400` döner (bkz. `requireCategory()`).
   */
  const visibleCategories = useMemo(
    () => categories.filter((category) => category.type === type),
    [categories, type],
  );

  /**
   * Tür değişince kategori seçimi TEMİZLENİR.
   *
   * Aksi halde seçim, artık listede görünmeyen ama state'te duran bir kategoriye takılı kalır;
   * kullanıcı "Gelir" seçtiği hâlde gizli bir gider kategorisiyle kaydetmeye çalışır ve
   * backend'den `400` alırdı — sebebi ekranda görünmeyen bir hata.
   */
  function handleTypeChange(nextType: string) {
    setType(nextType);
    setCategoryId("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(`/api/tenants/${tenantId}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId,
          type,
          amount,
          // Boş alanlar GÖNDERİLMEZ (`undefined`): boş string göndermek kategori için
          // "geçersiz id", tarih için "geçersiz tarih" dalını tetiklerdi. Gönderilmediğinde
          // backend kategoriyi boş bırakır, tarihi ise `@default(now())` ile doldurur.
          categoryId: categoryId === "" ? undefined : categoryId,
          description: description.trim() === "" ? undefined : description,
          occurredAt: occurredAt === "" ? undefined : occurredAt,
        }),
      });

      if (!response.ok) {
        setError(messageForStatus(response.status));
        return;
      }

      // Tutar ve açıklama TEMİZLENİR; hesap, tür ve tarih KORUNUR: kullanıcı genellikle aynı
      // günün fişlerini aynı hesaba arka arkaya girer, bunları her kayıtta yeniden seçmek
      // formdaki en sık tekrar eden işi geri getirirdi (kategori formundaki aynı gerekçe).
      setAmount("");
      setDescription("");
      // Liste sunucuda render edilir; `refresh()` sunucu bileşenini yeni veriyle yeniden
      // çalıştırır (aktif tenant değişmediği için tam sayfa yüklemeye gerek yok).
      router.refresh();
    } catch {
      setError(messageForStatus(0));
    } finally {
      setPending(false);
    }
  }

  const selectClassName =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="max-w-sm space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Yeni işlem</h2>

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label
            htmlFor="transaction-account"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Hesap
          </label>
          <select
            id="transaction-account"
            name="transaction-account"
            value={accountId}
            disabled={pending}
            onChange={(event) => setAccountId(event.target.value)}
            className={selectClassName}
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name} ({account.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="transaction-type"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Tür
          </label>
          <select
            id="transaction-type"
            name="transaction-type"
            value={type}
            disabled={pending}
            onChange={(event) => handleTypeChange(event.target.value)}
            className={selectClassName}
          >
            {TRANSACTION_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Tutar alanı `type="text"` + `inputMode="decimal"`, `type="number"` DEĞİL:
            `type="number"` tarayıcı/yerel ayara göre virgüllü girdiyi kabul edip değeri BOŞ
            string olarak geri verebilir ve kullanıcının yazdığı tutar sessizce kaybolurdu.
            API sözleşmesi zaten string bekler (invariant #10); alanın kullanıcının yazdığını
            birebir taşıması gerekir. `inputMode` mobilde sayısal klavyeyi yine de açar. */}
        <div className="space-y-1.5">
          <label
            htmlFor="transaction-amount"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Tutar
          </label>
          <input
            id="transaction-amount"
            name="transaction-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="1250.50"
            aria-describedby="transaction-amount-hint"
            value={amount}
            disabled={pending}
            onChange={(event) => setAmount(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50 dark:focus:ring-zinc-800"
          />
          <p id="transaction-amount-hint" className="text-xs text-zinc-500 dark:text-zinc-500">
            Ondalık ayırıcı nokta: 1250.50. Yön için tür alanını kullanın.
          </p>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="transaction-date"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Tarih
          </label>
          <input
            id="transaction-date"
            name="transaction-date"
            type="date"
            value={occurredAt}
            disabled={pending}
            onChange={(event) => setOccurredAt(event.target.value)}
            className={selectClassName}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="transaction-category"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Kategori
          </label>
          <select
            id="transaction-category"
            name="transaction-category"
            value={categoryId}
            disabled={pending}
            onChange={(event) => setCategoryId(event.target.value)}
            className={selectClassName}
          >
            {/* Kategori OPSİYONELDİR (#53): sınıflandırma sonradan da yapılabilir, kayıt bunu
                beklemez. Boş seçenek bu yüzden var ve ilk sırada. */}
            <option value="">Kategorisiz</option>
            {visibleCategories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </div>

        <TextField
          id="transaction-description"
          label="Açıklama"
          type="text"
          autoComplete="off"
          value={description}
          onChange={setDescription}
          disabled={pending}
          required={false}
          hint="İsteğe bağlı."
        />

        <FormError message={error} />

        <SubmitButton pending={pending}>
          {pending ? "Kaydediliyor…" : "İşlem kaydet"}
        </SubmitButton>
      </form>
    </div>
  );
}
