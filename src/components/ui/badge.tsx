import type { ReactNode } from "react";

/**
 * Etiket (badge) — kategori, tür, rol gibi kısa durum bilgileri için.
 *
 * RADIUS BİLEREK EN KÜÇÜK SEVİYE (`rounded-badge`): badge sayfadaki en küçük yüzeydir ve
 * kartlarla aynı yarıçapı paylaşırsa ikisi de aynı boyutta hissettirir (bkz. globals.css'teki
 * radius hiyerarşisi). Tam yuvarlak (`rounded-full`) da kullanılmadı — "pill" biçimi bu
 * arayüzde etiketi veriden çok reklama benzetiyordu.
 */

export type BadgeTone = "neutral" | "brand" | "mint" | "iris" | "danger" | "outline";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-inset text-body",
  brand: "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-200",
  mint: "bg-mint-50 text-mint-700 dark:bg-mint-950 dark:text-mint-300",
  iris: "bg-iris-100 text-iris-600 dark:bg-iris-600/20 dark:text-iris-300",
  danger: "bg-danger-50 text-danger-700 dark:bg-danger-900/40 dark:text-danger-200",
  // Çerçeveli varyant: dolgulu badge'lerin yanında "daha az önemli" demenin yolu.
  outline: "border border-line text-muted",
};

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: BadgeTone;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-badge px-2 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  );
}

/**
 * Kategori etiketi — tonu ADIN KENDİSİNDEN türetir.
 *
 * NEDEN RASTGELE DEĞİL, HASH: aynı kategori her ekranda, her sayfa yenilemesinde AYNI rengi
 * almalıdır; yoksa renk bir bilgi taşımaz, gürültü olur. Rastgele bir ton ya da dizideki
 * sıraya göre atama (liste filtrelenince kayar) bu garantiyi vermezdi.
 *
 * Ton havuzu bilinçli olarak KÜÇÜK ve marka paletinden: "her kategoriye ayrı bir renk" hem
 * paletin dışına çıkmayı hem de yan yana ayırt edilemeyen tonlar üretmeyi gerektirirdi.
 * Kategori sayısı ton sayısını aştığında renkler tekrar eder — kabul edildi, çünkü renk
 * burada kimlik değil, taramayı kolaylaştıran ikincil bir ipucudur; adın kendisi yanında.
 */
const CATEGORY_TONES: readonly BadgeTone[] = ["brand", "mint", "iris", "neutral"];

function toneForName(name: string): BadgeTone {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) % 100_000;
  }
  return CATEGORY_TONES[hash % CATEGORY_TONES.length];
}

export function CategoryBadge({ name }: { name: string | null }) {
  // "Kategorisiz" bir kategori DEĞİLDİR, kategorinin yokluğudur — bu yüzden renkli bir ton
  // almaz, çerçeveli ve soluk gösterilir. Aksi halde gerçek bir kategori sanılırdı.
  if (!name) {
    return <Badge tone="outline">Kategorisiz</Badge>;
  }

  return <Badge tone={toneForName(name)}>{name}</Badge>;
}
