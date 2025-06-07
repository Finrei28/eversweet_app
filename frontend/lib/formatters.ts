const Currency_Formatter = new Intl.NumberFormat("en-NZ", {
  style: "currency",
  currency: "NZD",
  minimumFractionDigits: 0,
})

export function formatCurrency(amount: number) {
  return Currency_Formatter.format(amount)
}

const Number_Formatter = new Intl.NumberFormat("en-NZ")

export function formatNumber(amount: number) {
  return Number_Formatter.format(amount)
}

export const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return new Intl.DateTimeFormat("en-NZ", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}

export const getCollectionTime = (date: Date) => {
  return new Intl.DateTimeFormat("en-NZ", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).format(date)
}

export const getEarnablePoints = (total: number) => {
  return Math.round(((total / 5) * 5) / 5)
}
