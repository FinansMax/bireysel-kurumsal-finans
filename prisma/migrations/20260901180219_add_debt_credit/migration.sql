-- CreateEnum
CREATE TYPE "DebtCreditType" AS ENUM ('DEBT', 'CREDIT');

-- CreateEnum
CREATE TYPE "DebtCreditStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateTable
CREATE TABLE "DebtCredit" (
    "id" TEXT NOT NULL,
    "type" "DebtCreditType" NOT NULL,
    "counterparty" TEXT NOT NULL,
    "amount" DECIMAL(19,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "dueDate" TIMESTAMP(3),
    "status" "DebtCreditStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantId" TEXT NOT NULL,

    CONSTRAINT "DebtCredit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DebtCredit_tenantId_status_dueDate_idx" ON "DebtCredit"("tenantId", "status", "dueDate");

-- AddForeignKey
ALTER TABLE "DebtCredit" ADD CONSTRAINT "DebtCredit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
