"use client"
import LegalDocumentScreen from "@/_components/legalDocumentScreen"
import { useTermsAndConditionsQuery } from "@/services/queries"

export default function TermsAndConditions() {
  const { data, isLoading, isError, refetch } = useTermsAndConditionsQuery()

  return (
    <LegalDocumentScreen
      document={data}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => void refetch()}
    />
  )
}
