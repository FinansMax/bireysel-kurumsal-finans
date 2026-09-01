"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FIELD_CLASS, FormError, LABEL_CLASS, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Borç/alacak kaydı formu (Issue #70).
 *
 * `account-form.tsx` ile BİREBİR aynı duruş: mevcut route'a gerçek HTTP isteği atar (servis
 * fonksiyonu doğrudan çağrılMAZ — yetki ve aktif tenant tutarlılığı route seviyesindedir),
 * tek bileşen iki modda çalışır (`record` verilirse düzenleme) ve `tenantId` prop olarak
 * SUNUCUDAN gelir.
 *
 * DURUM ALANI YALNIZCA DÜZENLEMEDE VAR: yeni bir kayıt tanımı gereği açıktır. "Kapandı" olarak
 * açılabilen bir form, kullanıcıyı hiç takip etmeyeceği bir kaydı girmeye davet ederdi.
 * (API geçmişe dönük kayıt için bunu yine de kabul eder — sözleşme arayüzden geniştir.)
 */

export type EditableDebtCredit = {
  id: string;
  type: string;
  counterparty: string;
  amount: string;
  currency: string;
  /** `YYYY-MM-DD` ya da `null` (vadesiz). */
  dueDate: string | null;
  status: string;
};

const TYPES = [
  { value: "DEBT", label: "Borç (ben borçluyum)" },
  { value: "CREDIT", label: "Alacak (bana borçlular)" },
] as const;

const STATUSES = [
  { value: "OPEN", label: "Açık" },
  { value: "SETTLED", label: "Kapandı" },
] as const;

function messageForStatus(status: number, editing: boolean): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: karşı taraf 2-100 karakter, tutar pozitif (1234.56), para birimi 3 harf (TRY), vade GG.AA.YYYY.";
    case 403:
      return editing
        ? "Bu çalışma alanında borç/alacak düzenleme yetkiniz yok."
        : "Bu çalışma alanında borç/alacak kaydetme yetkiniz yok.";
    case 404:
      // Kayıt araya girip silinmiş olabilir. "Başka tenant'ın kaydı" ile AYNI yanıt gelir
      // (enumeration engeli), bu yüzden mesaj da ayrım yapmaz.
      return "Bu kayıt artık mevcut değil. Sayfayı yenileyin.";
    default:
      return editing
        ? "Kayıt güncellenemedi. Lütfen daha sonra tekrar deneyin."
        : "Kayıt oluşturulamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

export function DebtCreditForm({
  tenantId,
  record,
}: {
  tenantId: string;
  /** Verilirse düzenleme modu. */
  record?: EditableDebtCredit;
}) {
  const router = useRouter();
  const editing = record !== undefined;

  const [type, setType] = useState<string>(record?.type ?? "DEBT");
  const [counterparty, setCounterparty] = useState(record?.counterparty ?? "");
  const [amount, setAmount] = useState(record?.amount ?? "");
  const [currency, setCurrency] = useState(record?.currency ?? "TRY");
  const [dueDate, setDueDate] = useState(record?.dueDate ?? "");
  const [status, setStatus] = useState<string>(record?.status ?? "OPEN");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(
        editing
          ? `/api/tenants/${tenantId}/debt-credits/${record.id}`
          : `/api/tenants/${tenantId}/debt-credits`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type,
            counterparty,
            // TUTAR STRING OLARAK GÖNDERİLİR: para JSON'da string taşınır (invariant #10) ve
            // backend `number` kabul etmez.
            amount: amount.trim(),
            currency,
            // Boş vade `null` gönderilir, atlanMAZ: düzenlemede kullanıcının vadeyi
            // TEMİZLEMESİ mümkün olmalı; alanı hiç göndermemek "değiştirme" demektir.
            dueDate: dueDate.trim() === "" ? null : dueDate.trim(),
            ...(editing ? { status } : {}),
          }),
        },
      );

      if (!response.ok) {
        setError(messageForStatus(response.status, editing));
        return;
      }

      if (editing) {
        router.push("/debt-credits");
        router.refresh();
        return;
      }

      setCounterparty("");
      setAmount("");
      setDueDate("");
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
        {editing ? "Kaydı düzenle" : "Yeni borç/alacak"}
      </h2>

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label={editing ? "Kaydı düzenle" : "Yeni borç/alacak"}
        noValidate
      >
        <div className="space-y-1.5">
          <label htmlFor="debt-type" className={LABEL_CLASS}>
            Tür
          </label>
          {/* Etiketler yönü AÇIKÇA yazar ("ben borçluyum" / "bana borçlular"): "Borç" ve
              "Alacak" sözcükleri tek başına, hangi tarafın kim olduğu konusunda düzenli olarak
              yanlış okunuyor. */}
          <select
            id="debt-type"
            name="debt-type"
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value)}
            className={FIELD_CLASS}
          >
            {TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <TextField
          id="debt-counterparty"
          label="Karşı taraf"
          type="text"
          autoComplete="off"
          value={counterparty}
          onChange={setCounterparty}
          disabled={pending}
          hint="Kişi ya da kurum adı."
        />

        <TextField
          id="debt-amount"
          label="Tutar"
          type="text"
          autoComplete="off"
          value={amount}
          onChange={setAmount}
          disabled={pending}
          hint="Ondalık ayırıcı nokta: 1234.56. Yön tür alanından gelir, eksi yazılmaz."
        />

        <TextField
          id="debt-currency"
          label="Para birimi"
          type="text"
          autoComplete="off"
          value={currency}
          onChange={setCurrency}
          disabled={pending}
          hint="ISO 4217 kodu, ör. TRY, USD, EUR."
        />

        <div className="space-y-1.5">
          <label htmlFor="debt-due-date" className={LABEL_CLASS}>
            Vade (isteğe bağlı)
          </label>
          {/* Vade OPSİYONELDİR: "borçluyum ama tarihi belli değil" meşru bir kayıttır ve
              kullanıcıyı uydurma bir tarih girmeye zorlamak veriyi sessizce bozardı. */}
          <input
            id="debt-due-date"
            name="debt-due-date"
            type="date"
            value={dueDate}
            disabled={pending}
            onChange={(event) => setDueDate(event.target.value)}
            className={FIELD_CLASS}
          />
        </div>

        {editing && (
          <div className="space-y-1.5">
            <label htmlFor="debt-status" className={LABEL_CLASS}>
              Durum
            </label>
            <select
              id="debt-status"
              name="debt-status"
              value={status}
              disabled={pending}
              onChange={(event) => setStatus(event.target.value)}
              className={FIELD_CLASS}
            >
              {STATUSES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {/* Kullanıcı bunu bilmeli: "kapandı" işareti bir ÖDEME KAYDI DEĞİLDİR. */}
            <p className="text-xs text-muted">
              &quot;Kapandı&quot; işareti bir işlem oluşturmaz; ödemeyi ayrıca işlemler
              ekranından kaydedin.
            </p>
          </div>
        )}

        <FormError message={error} />

        <SubmitButton pending={pending}>
          {pending
            ? editing
              ? "Kaydediliyor…"
              : "Oluşturuluyor…"
            : editing
              ? "Değişiklikleri kaydet"
              : "Kaydet"}
        </SubmitButton>
      </form>
    </div>
  );
}
