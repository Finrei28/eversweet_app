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

export const formatShortDate = (date: Date) => {
  const newDate = new Date(date)
  return new Intl.DateTimeFormat("en-NZ", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).format(newDate)
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

export function roundToNearest5(date: Date) {
  const ms = 1000 * 60 * 5
  return new Date(Math.ceil(date.getTime() / ms) * ms)
}
