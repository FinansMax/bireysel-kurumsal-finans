import Link from "next/link";
import type { ReactNode } from "react";

/**
 * Boş durum ekranı.
 *
 * "Henüz kayıt yok." yazıp bırakmak, kullanıcıyı bir çıkmazda tek başına bırakmaktır: ekran
 * boştur, ne olduğu belirsizdir ve ne yapılacağı söylenmez. Buradaki desen üç şeyi birlikte
 * verir — bir görsel çapa, ne olduğunu söyleyen bir cümle ve MÜMKÜNSE bir eylem.
 *
 * EYLEM OPSİYONELDİR ve bilerek: yetkisi olmayan bir kullanıcıya (ör. MEMBER) "ilkini oluştur"
 * demek, kesin 403 alacağı bir yola davet etmek olurdu. Çağıran taraf yetkiye göre karar verir.
 *
 * Metinler prop'tur, bileşenin içinde SABİT DEĞİL: her ekranın boşluğu farklı bir şey anlatır
 * ("hiç kayıt yok" ile "filtreyle eşleşen yok" aynı cümleyi paylaşmamalı, bkz. #56).
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description?: ReactNode;
  action?: { label: string; href: string };
}) {
  return (
    <div className="flex flex-col items-center rounded-panel border border-dashed border-line bg-surface px-6 py-14 text-center">
      {/* Kesikli çerçeve: dolu bir kart "burada içerik var" der; kesikli çerçeve "burası
          doldurulmayı bekliyor" der. Boş durumun kendisi bir mesajdır. */}
      <span className="flex size-11 items-center justify-center rounded-card bg-brand-50 text-brand-600 dark:bg-brand-950 dark:text-brand-300">
        {icon}
      </span>

      <h3 className="mt-4 text-sm font-semibold text-strong">{title}</h3>

      {description ? (
        <p className="mt-1.5 max-w-sm text-sm text-pretty text-muted">{description}</p>
      ) : null}

      {action ? (
        <Link
          href={action.href}
          className="mt-5 inline-flex items-center justify-center rounded-control bg-brand-600 px-3.5 py-2 text-sm font-medium text-white transition-colors duration-150 ease-out-soft hover:bg-brand-700"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}
