"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { FormError, SubmitButton, TextField } from "@/components/auth-form";

/**
 * Hesap oluşturma ve düzenleme formu (Issue #47 + #130).
 *
 * Mevcut `POST /api/tenants/:tenantId/accounts` veya `PATCH .../accounts/:accountId`'e gerçek
 * HTTP isteği atar; servis fonksiyonu doğrudan çağrılMAZ — yetkilendirme
 * (`requirePermission(MANAGE_ACCOUNTS)`) ve aktif tenant tutarlılık kontrolü route
 * seviyesindedir.
 *
 * TEK BİLEŞEN, İKİ MOD: `account` prop'u verilirse düzenleme, verilmezse oluşturma. Ayrı bir
 * `EditAccountForm` yazmak, alanların ve doğrulama mesajlarının neredeyse tamamını kopyalamak
 * olurdu; ayrışan yer yalnızca hedef URL, düğme metni ve başarı sonrası davranıştır.
 *
 * `tenantId` prop olarak SUNUCUDAN gelir (aktif tenant); istemcinin uydurduğu bir değer
 * değildir. Uydurulsaydı bile backend aktif tenant ile eşleşmeyen bir tenantId'yi 403'le
 * reddederdi (bkz. `requirePermission()` → `expectedTenantId`).
 */

export type EditableAccount = {
  id: string;
  name: string;
  type: string;
  currency: string;
};

function messageForStatus(status: number, editing: boolean): string {
  switch (status) {
    case 400:
      return "Bilgileri kontrol edin: ad 2-100 karakter, para birimi 3 harf (TRY).";
    case 403:
      return editing
        ? "Bu çalışma alanında hesap düzenleme yetkiniz yok."
        : "Bu çalışma alanında hesap oluşturma yetkiniz yok.";
    case 404:
      // Kayıt araya girip silinmiş olabilir. "Başka tenant'ın hesabı" ile aynı yanıt gelir
      // (enumeration engeli), bu yüzden mesaj da ayrım yapmaz.
      return "Bu hesap artık mevcut değil. Sayfayı yenileyin.";
    case 409:
      return "Bu isimde bir hesap zaten var. Farklı bir ad deneyin.";
    default:
      return editing
        ? "Hesap güncellenemedi. Lütfen daha sonra tekrar deneyin."
        : "Hesap oluşturulamadı. Lütfen daha sonra tekrar deneyin.";
  }
}

const ACCOUNT_TYPES = [
  { value: "BANK", label: "Banka" },
  { value: "CASH", label: "Kasa" },
] as const;

export function AccountForm({
  tenantId,
  account,
}: {
  tenantId: string;
  /** Verilirse düzenleme modu. */
  account?: EditableAccount;
}) {
  const router = useRouter();
  const editing = account !== undefined;

  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<string>(account?.type ?? "BANK");
  const [currency, setCurrency] = useState(account?.currency ?? "TRY");
  const [balance, setBalance] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch(
        editing ? `/api/tenants/${tenantId}/accounts/${account.id}` : `/api/tenants/${tenantId}/accounts`,
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          // BAKİYE STRING OLARAK GÖNDERİLİR ve boşsa alan hiç gönderilmez (`undefined`):
          // para JSON'da string taşınır (invariant #10) ve backend `number` kabul etmez.
          // Boş string göndermek "geçersiz tutar" dalını tetikler, oysa kullanıcının kastı
          // "açılış bakiyesi belirtmiyorum"dur — o durumda şemadaki `@default(0)` geçerli olur.
          //
          // DÜZENLEMEDE `balance` HİÇ GÖNDERİLMEZ; gerekçe aşağıdaki alanın yorumundadır.
          body: JSON.stringify({
            name,
            type,
            currency,
            balance: editing || balance.trim() === "" ? undefined : balance.trim(),
          }),
        },
      );

      if (!response.ok) {
        setError(messageForStatus(response.status, editing));
        return;
      }

      if (editing) {
        // Düzenleme bitince listeye dönülür: `?edit=` parametresi URL'de kalırsa kullanıcı
        // kaydettiği hâlde hâlâ formda duruyormuş gibi görünürdü.
        router.push("/accounts");
        router.refresh();
        return;
      }

      setName("");
      setBalance("");
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
    <div className="max-w-sm space-y-4 border-t border-zinc-200 pt-6 dark:border-zinc-800">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
        {editing ? "Hesabı düzenle" : "Yeni hesap"}
      </h2>

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        aria-label={editing ? "Hesabı düzenle" : "Yeni hesap"}
        noValidate
      >
        <TextField
          id="account-name"
          label="Hesap adı"
          type="text"
          autoComplete="off"
          value={name}
          onChange={setName}
          disabled={pending}
        />

        <div className="space-y-1.5">
          <label
            htmlFor="account-type"
            className="block text-sm font-medium text-zinc-900 dark:text-zinc-100"
          >
            Tür
          </label>
          <select
            id="account-type"
            name="account-type"
            value={type}
            disabled={pending}
            onChange={(event) => setType(event.target.value)}
            className="w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-950 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-50"
          >
            {ACCOUNT_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        <TextField
          id="account-currency"
          label="Para birimi"
          type="text"
          autoComplete="off"
          value={currency}
          onChange={setCurrency}
          disabled={pending}
          hint="ISO 4217 kodu, ör. TRY, USD, EUR."
        />

        {/* BAKİYE YALNIZCA OLUŞTURMADA VAR — düzenlemede BİLEREK yok.
            #53'ten beri `Account.balance` işlemlerden TÜRETİLİR: her işlem onu aynı DB
            transaction'ı içinde günceller. Düzenleme formunda elle bakiye alanı açmak,
            kullanıcıyı "bakiye = işlemlerin toplamı" invariant'ını sessizce bozmaya davet
            ederdi; bakiyeyi değiştirmenin doğru yolu bir işlem kaydetmektir.
            Açılışta alan var çünkü orada bakiye türetilen değil BAŞLANGIÇ noktasıdır.
            (Bilinen sınır: API hâlâ `balance` güncellemesini kabul ediyor — bkz. README.) */}
        {!editing && (
          <TextField
            id="account-balance"
            label="Açılış bakiyesi (isteğe bağlı)"
            type="text"
            autoComplete="off"
            value={balance}
            onChange={setBalance}
            disabled={pending}
            required={false}
            hint="Ondalık ayırıcı nokta: 1234.56. Boş bırakılırsa 0 kabul edilir."
          />
        )}

        <FormError message={error} />

        <SubmitButton pending={pending}>
          {pending
            ? editing
              ? "Kaydediliyor…"
              : "Oluşturuluyor…"
            : editing
              ? "Değişiklikleri kaydet"
              : "Hesap oluştur"}
        </SubmitButton>
      </form>
    </div>
  );
}
