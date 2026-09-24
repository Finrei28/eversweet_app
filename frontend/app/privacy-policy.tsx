"use client"
import LegalDocumentScreen from "@/_components/legalDocumentScreen"
import { usePrivacyPolicyQuery } from "@/services/queries"

export default function PrivacyPolicy() {
  const { data, isLoading, isError, refetch } = usePrivacyPolicyQuery()

  return (
    <LegalDocumentScreen
      document={data}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    />
  )
}
