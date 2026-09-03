#!/usr/bin/env bash
#
# Haftalik TASINABILIR mantiksal dokum (Issue #185).
#
# NEDEN BU SCRIPT VAR: saglayicinin kendi yedegi, hesabin kilitlenmesi ya da saglayicinin
# kendisinin kaybedilmesi durumunda ERISILEMEZ; snapshot formati da saglayiciya ozeldir ve
# baska bir Postgres'e tasinamaz. `pg_dump -Fc` ciktisi herhangi bir Postgres 16'ya
# `pg_restore` ile yuklenir - saglayici kilidini kiran tek sey budur (#95'ten devralinan
# kisit). Bu dokum, Neon'un otomatik yedeginin YERINE degil YANINA gelir.
#
# NEDEN BASH + pg_dump, NEDEN BIR NPM PAKETI DEGIL: geri donus provasinin (bkz.
# docs/runbook-restore.md) kullandigi araclarin AYNISI kullanilmalidir. Yedegi bir araçla
# alip baskasiyla geri yuklemek, provanin dogruladigi seyi degistirir. Ayrica bu repo
# bilinçli olarak yalindir; yedekleme icin bagimlilik eklenmedi.
#
# KULLANIM
#   BACKUP_DATABASE_URL=... BACKUP_S3_BUCKET=... ./scripts/backup-dump.sh
#
# GEREKENLER: pg_dump (postgresql-client 16+), aws CLI (S3/R2 uyumlu).
#
# ZAMANLAMA: haftalik. Platformun zamanlanmis isi ya da ayri bir runner cagirir; bu script
# zamanlayici KURMAZ - bunu yapmak deployment hedefine ve credential'lara baglidir (#185
# kalan is, bkz. docs/data-retention.md § 4).

set -euo pipefail

# --- Girdi dogrulama: eksik bir degisken, SESSIZ bir yedeksizlik demektir --------------------
# Bu blogun tamami "yedek aliniyor sandik, alinmiyormus" senaryosunu onlemek icindir.

: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL tanimli degil. DOGRUDAN baglanti adresi olmali (pooler DEGIL) - gerekcesi docs/deployment.md § 3}"
: "${BACKUP_S3_BUCKET:?BACKUP_S3_BUCKET tanimli degil}"

RETENTION_WEEKS="${BACKUP_RETENTION_WEEKS:-8}"
PREFIX="${BACKUP_S3_PREFIX:-pg}"
ENDPOINT_ARG=()
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  # Cloudflare R2 ve S3 uyumlu diger depolar icin.
  ENDPOINT_ARG=(--endpoint-url "$BACKUP_S3_ENDPOINT")
fi

# POOLER UZERINDEN DOKUM ALINMAZ. pg_dump uzun suren tek bir oturum acar ve tutarli bir
# snapshot icin oturum durumuna guvenir; PgBouncer transaction modunda bu bozulur ve dokum
# TUTARSIZ cikabilir - üstelik hata vermeden. Bu yuzden adres kontrol edilir.
case "$BACKUP_DATABASE_URL" in
  *-pooler.*)
    echo "HATA: BACKUP_DATABASE_URL bir POOLER adresi gibi gorunuyor (host'unda '-pooler' var)." >&2
    echo "      Dokum DOGRUDAN baglanti uzerinden alinmalidir. Bkz. docs/deployment.md § 3." >&2
    exit 1
    ;;
esac

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
YEAR="$(date -u +%Y)"
WORK="$(mktemp -d)"
DUMP="$WORK/finans-$STAMP.dump"

cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

# --- 1. Dokum ------------------------------------------------------------------------------
echo "[1/4] pg_dump -Fc ..."
START=$(date +%s)
pg_dump --dbname="$BACKUP_DATABASE_URL" --format=custom --file="$DUMP"
DUMP_SECONDS=$(( $(date +%s) - START ))
DUMP_BYTES=$(wc -c < "$DUMP")
echo "      ${DUMP_BYTES} bayt, ${DUMP_SECONDS} sn"

# --- 2. Dokumu DOGRULA ---------------------------------------------------------------------
# "pg_dump 0 ile cikti" yeterli degildir. Okunamayan bir dokum, olay aninda fark edilirse
# yedeksiz kalmak demektir; burada fark edilirse yalnizca bir uyaridir.
echo "[2/4] dokum dogrulaniyor (pg_restore --list) ..."
if ! pg_restore --list "$DUMP" > "$WORK/toc.txt"; then
  echo "HATA: dokum okunamiyor - YUKLENMEYECEK." >&2
  exit 1
fi
ENTRIES=$(grep -c . < "$WORK/toc.txt")
if [ "$ENTRIES" -lt 10 ]; then
  echo "HATA: dokum icerigi supheli sekilde kucuk ($ENTRIES kayit). Yuklenmiyor." >&2
  exit 1
fi
# Prisma migration tablosu dokumun icinde OLMALI: onsuz geri donus, migration durumu
# bilinmeyen bir veritabani uretir (bkz. docs/runbook-restore.md § 6).
if ! grep -q "_prisma_migrations" "$WORK/toc.txt"; then
  echo "HATA: dokumde _prisma_migrations yok. Yuklenmiyor." >&2
  exit 1
fi
echo "      ${ENTRIES} kayit, _prisma_migrations mevcut"

# --- 3. Yukle ------------------------------------------------------------------------------
# 'latest.dump' KOPYADIR, symlink degil: runbook'un ilk adimi bunu indirir ve olay aninda
# "hangi dosya en yeni" sorusuyla ugrasilmamalidir.
KEY="s3://$BACKUP_S3_BUCKET/$PREFIX/$YEAR/finans-$STAMP.dump"
echo "[3/4] yukleniyor -> $KEY"
aws "${ENDPOINT_ARG[@]}" s3 cp "$DUMP" "$KEY" --sse AES256
aws "${ENDPOINT_ARG[@]}" s3 cp "$DUMP" "s3://$BACKUP_S3_BUCKET/$PREFIX/$YEAR/latest.dump" --sse AES256

# --- 4. Rotasyon ---------------------------------------------------------------------------
# Saklama suresi docs/data-retention.md'de yazili: 8 hafta. Sekiz hafta, "bozulma haftalar
# sonra fark edildi" senaryosunda geriye gidebilmek icindir.
echo "[4/4] ${RETENTION_WEEKS} haftadan eski dokumler siliniyor ..."
CUTOFF=$(date -u -d "-${RETENTION_WEEKS} weeks" +%Y%m%d 2>/dev/null || date -u -v-"${RETENTION_WEEKS}"w +%Y%m%d)
aws "${ENDPOINT_ARG[@]}" s3 ls "s3://$BACKUP_S3_BUCKET/$PREFIX/$YEAR/" \
  | awk '{print $4}' \
  | grep -E '^finans-[0-9]{8}T[0-9]{6}Z\.dump$' \
  | while read -r name; do
      d="${name#finans-}"; d="${d%%T*}"
      if [ "$d" -lt "$CUTOFF" ]; then
        echo "      siliniyor: $name"
        aws "${ENDPOINT_ARG[@]}" s3 rm "s3://$BACKUP_S3_BUCKET/$PREFIX/$YEAR/$name"
      fi
    done

echo "TAMAM: $KEY (${DUMP_BYTES} bayt, ${DUMP_SECONDS} sn)"
