"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

/**
 * İşlem CSV içe aktarma formu (Issue #83).
 *
 * DOSYA TARAYICIDA OKUNUR ve metin olarak `POST .../transactions/import`'a gönderilir (route'ta
 * gerekçesi var: multipart ikinci bir girdi yüzeyi olurdu). Server Action DEĞİL — rate limit
 * ve `requirePermission()` route'tadır (`transaction-form.tsx` ile aynı duruş).
 *
 * Boyut sınırı burada da kontrol edilir ama bu yalnızca KULLANICI DOSTLUĞUDUR (büyük dosyayı
 * boşuna yüklememek); asıl sınır sunucudadır.
 */

const MAX_IMPORT_BYTES = 512 * 1024;

const ROW_ERROR_LABELS: Record<string, string> = {
  column_count: "sütun sayısı başlıkla uyuşmuyor",
  invalid_type: "tür INCOME veya EXPENSE olmalı",
  invalid_amount: "tutar pozitif olmalı (ör. 1234.56)",
  invalid_occurred_at: "tarih YYYY-AA-GG biçiminde olmalı",
  invalid_account_id: "hesap kimliği geçersiz",
  invalid_category_id: "kategori kimliği geçersiz",
  invalid_description: "açıklama çok uzun",
  account_not_found: "hesap bulunamadı",
  category_not_found: "kategori bulunamadı",
  category_type_mismatch: "kategori türü işlem türüyle uyuşmuyor",
};

const FILE_ERROR_LABELS: Record<string, string> = {
  empty_file: "Dosyada içe aktarılacak satır yok.",
  malformed_csv: "Dosya geçerli bir CSV değil (tırnak işaretlerini kontrol edin).",
  missing_columns: "Zorunlu sütunlar eksik: type, amount, occurred_at, account_id.",
  unknown_columns: "Dosyada tanınmayan bir sütun var. Şablondaki sütun adlarını kullanın.",
  duplicate_columns: "Aynı sütun birden fazla kez yazılmış.",
  too_many_rows: "Tek dosyada en fazla 1000 satır içe aktarılabilir.",
  no_valid_rows: "Hiçbir satır içe aktarılamadı.",
};

type RowError = { line: number; code: string };
type Outcome =
  | { kind: "success"; imported: number; errors: RowError[] }
  | { kind: "failure"; message: string; errors: RowError[] };

function messageForStatus(status: number, error: unknown): string {
  if (status === 400 && typeof error === "string" && FILE_ERROR_LABELS[error]) {
    return FILE_ERROR_LABELS[error];
  }
  switch (status) {
    case 403:
      return "İşlem içe aktarma yetkiniz yok.";
    case 409:
      return "İçe aktarma sırasında hesap veya kategoriler değişti; hiçbir kayıt yazılmadı. Tekrar deneyin.";
    case 413:
      return "Dosya çok büyük (en fazla 512 KB).";
    case 429:
      return "Çok fazla içe aktarma denemesi. Lütfen bir süre sonra tekrar deneyin.";
    default:
      return "İçe aktarma başarısız oldu. Lütfen tekrar deneyin.";
  }
}

export function TransactionImportForm({
  tenantId,
  accounts,
}: {
  tenantId: string;
  accounts: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOutcome(null);
    if (!file) {
      setOutcome({ kind: "failure", message: "Önce bir CSV dosyası seçin.", errors: [] });
      return;
    }
    if (file.size > MAX_IMPORT_BYTES) {
      setOutcome({ kind: "failure", message: messageForStatus(413, null), errors: [] });
      return;
    }

    setPending(true);
    try {
      const response = await fetch(`/api/tenants/${tenantId}/transactions/import`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: await file.text(),
      });
      const body = (await response.json().catch(() => ({}))) as {
        imported?: number;
        error?: unknown;
        errors?: RowError[];
      };

      if (!response.ok) {
        setOutcome({
          kind: "failure",
          message: messageForStatus(response.status, body.error),
          errors: body.errors ?? [],
        });
        return;
      }

      setOutcome({ kind: "success", imported: body.imported ?? 0, errors: body.errors ?? [] });
      // Yeni işlemler ve kayan bakiyeler listede görünsün.
      router.refresh();
    } catch {
      setOutcome({ kind: "failure", message: messageForStatus(0, null), errors: [] });
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-labelledby="transaction-import-heading"
      className="space-y-3 rounded-panel border border-line bg-surface p-5"
      noValidate
    >
      <div className="space-y-1">
        <h2 id="transaction-import-heading" className="text-sm font-semibold text-strong">
          CSV&apos;den içe aktar
        </h2>
        <p className="text-sm text-pretty text-muted">
          Sütunlar: <code>type</code>, <code>amount</code>, <code>occurred_at</code>,{" "}
          <code>account_id</code>, isteğe bağlı <code>description</code> ve{" "}
          <code>category_id</code>. Dışa aktarılan dosya olduğu gibi geri yüklenebilir. Geçerli
          satırlar tek seferde kaydedilir; hatalı satırlar aşağıda listelenir.
        </p>
      </div>

      <details className="text-sm text-muted">
        <summary className="cursor-pointer font-medium text-body">Hesap kimlikleri</summary>
        <ul className="mt-2 space-y-1">
          {accounts.map((account) => (
            <li key={account.id}>
              {account.name}: <code className="text-strong">{account.id}</code>
            </li>
          ))}
        </ul>
      </details>

      <div className="space-y-1.5">
        <label htmlFor="transaction-import-file" className="text-sm font-medium text-strong">
          CSV dosyası
        </label>
        <input
          id="transaction-import-file"
          type="file"
          accept=".csv,text/csv"
          disabled={pending}
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          className="block text-sm text-body"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="rounded-control bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "İçe aktarılıyor…" : "İçe aktar"}
      </button>

      {outcome?.kind === "success" ? (
        <p role="status" className="text-sm font-medium text-mint-700 dark:text-mint-300">
          {outcome.imported} işlem içe aktarıldı.
        </p>
      ) : null}
      {outcome?.kind === "failure" ? (
        <p role="alert" className="text-sm text-danger-600 dark:text-danger-300">
          {outcome.message}
        </p>
      ) : null}
      {outcome && outcome.errors.length > 0 ? (
        <ul aria-label="Hatalı satırlar" className="space-y-1 text-sm text-danger-600 dark:text-danger-300">
          {outcome.errors.map((error) => (
            <li key={`${error.line}-${error.code}`}>
              Satır {error.line}: {ROW_ERROR_LABELS[error.code] ?? "geçersiz satır"}
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
