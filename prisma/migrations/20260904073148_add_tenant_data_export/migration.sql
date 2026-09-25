-- CreateEnum
CREATE TYPE "TenantDataExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED');

-- CreateTable
CREATE TABLE "TenantDataExport" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "requestedByUserId" TEXT NOT NULL,
    "status" "TenantDataExportStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "downloadedAt" TIMESTAMP(3),
    "filePath" TEXT,
    "byteSize" INTEGER,
    "rowCounts" JSONB,
    "failureReason" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TenantDataExport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TenantDataExport_tokenHash_key" ON "TenantDataExport"("tokenHash");

-- CreateIndex
CREATE INDEX "TenantDataExport_tenantId_idx" ON "TenantDataExport"("tenantId");

-- CreateIndex
CREATE INDEX "TenantDataExport_status_createdAt_idx" ON "TenantDataExport"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "TenantDataExport" ADD CONSTRAINT "TenantDataExport_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
