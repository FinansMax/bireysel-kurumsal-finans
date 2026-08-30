"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * İşlem kaydetme ve düzenleme formu (Issue #54 + #130).
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

export type EditableTransaction = {
  id: string;
  accountId: string;
  categoryId: string | null;
  type: string;
  amount: string;
  description: string | null;
  /** `YYYY-MM-DD` — tarih alanının beklediği biçim. */
  occurredAt: string;
};

const TRANSACTION_TYPES = [
  { value: "EXPENSE", label: "Gider" },
  { value: "INCOME", label: "Gelir" },
] as const;

function messageForStatus(status: number, editing: boolean): string {
  switch (status) {
    case 400:
      // Düzenlemede 400'ün İKİNCİ bir sebebi var: tür değiştirilip mevcut kategori yanlış
      // tarafta bırakılmış olabilir (#53). Kullanıcı bunu formda göremediği için mesaj
      // açıkça söyler; aksi halde "tutar hatalı" sanıp doğru alanı aramaya devam ederdi.
      return editing
        ? "Bilgileri kontrol edin: tutar 0'dan büyük olmalı (ör. 1250.50). Türü değiştirdiyseniz kategoriyi de yeni türe uygun bir kategoriyle değiştirin veya 'Kategorisiz' seçin."
        : "Bilgileri kontrol edin: tutar 0'dan büyük olmalı ve en fazla 4 ondalık basamak içerebilir (ör. 1250.50).";
    case 403:
      return editing
        ? "Bu çalışma alanında işlem düzenleme yetkiniz yok."
        : "Bu çalışma alanında işlem kaydetme yetkiniz yok.";
    case 404:
      // Seçilenler sayfa açıldığından beri silinmiş olabilir. Kullanıcıya "hesap mı kategori
      // mi" diye sormak yerine tek eylem önerilir: sayfayı yenile.
      return "Seçtiğiniz hesap veya kategori artık mevcut değil. Sayfayı yenileyip tekrar deneyin.";
    case 503:
      // Geçici yazma çakışması (#122); iş kuralı ihlali DEĞİLDİR, doğru mesaj "tekrar deneyin".
      return "Kayıt şu anda tamamlanamadı. Lütfen birkaç saniye sonra tekrar deneyin.";
    default:
      return editing
        ? "İşlem güncellenemedi. Lütfen daha sonra tekrar deneyin."
        : "İşlem kaydedilemedi. Lütfen daha sonra tekrar deneyin.";
  }
}

export function TransactionForm({
  tenantId,
  accounts,
  categories,
  today,
  transaction,
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
  /** Verilirse düzenleme modu. */
  transaction?: EditableTransaction;
}) {
  const router = useRouter();
  const editing = transaction !== undefined;

  // Hesap seçicisi boş bırakılmaz: tek hesabı olan kullanıcı (en yaygın durum) hiç seçim
  // yapmak zorunda kalmaz. Bu bileşen yalnızca en az bir hesap varken render edilir.
  const [accountId, setAccountId] = useState(transaction?.accountId ?? accounts[0]?.id ?? "");
  // Varsayılan "Gider": kayıtların ezici çoğunluğu gider tarafındadır (kategori formundaki
  // aynı karar).
  const [type, setType] = useState<string>(transaction?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(transaction?.amount ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? "");
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [occurredAt, setOccurredAt] = useState(transaction?.occurredAt ?? today);
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
      const response = await fetch(
        editing
          ? `/api/tenants/${tenantId}/transactions/${transaction.id}`
          : `/api/tenants/${tenantId}/transactions`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountId,
            type,
            amount,
            // OLUŞTURMADA boş alanlar GÖNDERİLMEZ (`undefined`): boş string kategori için
            // "geçersiz id", tarih için "geçersiz tarih" dalını tetiklerdi. Gönderilmediğinde
            // backend kategoriyi boş bırakır, tarihi `@default(now())` ile doldurur.
            //
            // DÜZENLEMEDE kategori için `null` GÖNDERİLİR, `undefined` DEĞİL: PATCH kısmi
            // güncellemedir ve `undefined` "bu alana dokunma" demektir. Kullanıcı kategoriyi
            // "Kategorisiz"e çektiğinde alan atlanırsa eski kategori olduğu gibi kalır ve
            // kullanıcı kaydettiği hâlde değişmediğini görürdü. `null` ise "kaldır" demektir
            // (bkz. `updateTransaction()`). Açıklamada da aynı ayrım: boş metin "notu sil"
            // demektir ve backend boş/boşluk-only değeri zaten `null`a indirger.
            categoryId: categoryId === "" ? (editing ? null : undefined) : categoryId,
            description: description.trim() === "" ? (editing ? "" : undefined) : description,
            occurredAt: occurredAt === "" ? undefined : occurredAt,
          }),
        },
      );

      if (!response.ok) {
        setError(messageForStatus(response.status, editing));
        return;
      }

      if (editing) {
        // Düzenleme bitince listeye dönülür; `?edit=` URL'de kalırsa kullanıcı kaydettiği
        // hâlde hâlâ formda duruyormuş gibi görünürdü. Filtreler BİLEREK korunmaz: kaydedilen
        // değişiklik satırı mevcut filtrenin dışına taşımış olabilir ve kullanıcı kaydının
        // "kaybolduğunu" sanardı — tam listeye dönmek olan biteni görünür kılar.
        router.push("/transactions");
        router.refresh();
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
      setError(messageForStatus(0, editing));
    } finally {
      setPending(false);
    }
  }

  const selectClassName =
    "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50";

  return (
    <div className="max-w-sm space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        {editing ? "İşlemi düzenle" : "Yeni işlem"}
      </h2>

      {/* `aria-label`: sayfada İKİ form var (filtre ve kayıt) ve ikisinde de "Hesap",
          "Kategori" gibi aynı etiketler geçiyor. Erişilebilir ad olmadan ekran okuyucu
          kullanıcısı hangi formda olduğunu ayırt edemez; E2E testleri de alanları bu adla
          kapsamlandırır (bkz. transactions-ui.spec.ts). */}
      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label={editing ? "İşlemi düzenle" : "Yeni işlem"}
        noValidate
      >
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
          {pending ? "Kaydediliyor…" : editing ? "Değişiklikleri kaydet" : "İşlem kaydet"}
        </SubmitButton>
      </form>
    </div>
  );
}
