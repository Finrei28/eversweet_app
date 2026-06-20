import { Order, PrintJob } from "@/lib/types"
import AsyncStorage from "@react-native-async-storage/async-storage"
import thermalPrinter from "./thermal-printer"

const PRINT_QUEUE_KEY = "print_queue"
class PrinterManager {
  private queue: PrintJob[] = []
  private isPrinting = false

  enqueue(printJob: PrintJob) {
    const alreadyQueued = this.queue.some(
      (queuedOrder) => queuedOrder.id === printJob.id,
    )
    if (!alreadyQueued) {
      this.queue.push(printJob)
    }
    this.processQueue()
  }

  private async processQueue() {
    if (this.isPrinting) {
      return
    }

    this.isPrinting = true

    try {
      while (this.queue.length > 0) {
        const printJob = this.queue.shift()

        if (!printJob) continue

        try {
          await this.printOrderWithRetry(printJob.order)

          // Only remove after successful print
          await removeJob(printJob.id)
        } catch (error) {
          console.error(`Failed to print order ${printJob.id}`, error)
          this.queue.unshift(printJob)
          break

          // Keep the job in AsyncStorage so it can be retried later
        }
      }
    } finally {
      this.isPrinting = false
    }
  }

  private async printOrder(order: Order) {
    const defaultPrinter = await thermalPrinter.getDefaultPrinter()

    if (!defaultPrinter) {
      throw new Error("No default printer configured")
    }

    if (!(await thermalPrinter.isPrinterConnected())) {
      const connected = await thermalPrinter.connectToPrinter(defaultPrinter.id)

      if (!connected) {
        throw new Error("Failed to connect")
      }
    }

    const result = await thermalPrinter.printReceipt(order)

    if (!result.success) {
      throw new Error(result.message)
    }
  }

  private async printOrderWithRetry(order: Order, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        await this.printOrder(order)
        return
      } catch (error) {
        console.warn(`Print attempt ${i + 1} failed`)
        if (i < retries - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1000))
        }
      }
    }

    throw new Error("Print failed after retries")
  }

  async retryPendingJobs() {
    await this.restorePendingJobs()
    this.processQueue()
  }

  async restorePendingJobs() {
    try {
      const existing = await AsyncStorage.getItem(PRINT_QUEUE_KEY)

      const jobs: PrintJob[] = existing ? JSON.parse(existing) : []

      for (const job of jobs) {
        this.enqueue(job)
      }
    } catch (error) {
      console.error("Failed to restore print jobs", error)
    }
  }
}

const printerService = new PrinterManager()
export default printerService

export const addJob = async (order: Order) => {
  const job: PrintJob = {
    id: order.id,
    order,
    createdAt: new Date().toISOString(),
    status: "pending",
  }

  const existing = await AsyncStorage.getItem(PRINT_QUEUE_KEY)

  const jobs: PrintJob[] = existing ? JSON.parse(existing) : []

  const exists = jobs.some((job) => job.id === order.id)

  if (!exists) {
    jobs.push(job)
  }

  await AsyncStorage.setItem(PRINT_QUEUE_KEY, JSON.stringify(jobs))

  return job
}

export const removeJob = async (jobId: string) => {
  const existing = await AsyncStorage.getItem(PRINT_QUEUE_KEY)

  if (!existing) return

  const jobs: PrintJob[] = JSON.parse(existing)

  const updatedJobs = jobs.filter((job) => job.id !== jobId)

  await AsyncStorage.setItem(PRINT_QUEUE_KEY, JSON.stringify(updatedJobs))
}
