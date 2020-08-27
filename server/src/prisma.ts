import { PrismaClient} from '@prisma/client'

// TODO: attach to `context` instead of importing from here
export const prisma = new PrismaClient({
  log: ['query']
})

