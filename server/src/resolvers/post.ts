import {
  Arg,
  Ctx,
  Field,
  FieldResolver,
  InputType,
  Int,
  Mutation,
  Query,
  Resolver,
  Root,
  ObjectType,
  UseMiddleware,
} from 'type-graphql'
import { Post as PostEntity } from '../entities/Post'
import { User as UserEntity } from '../entities/User'
import { isAuth } from '../middleware/isAuth'
import { MyContext } from '../types'

@InputType()
class PostInput {
  @Field()
  title: string
  @Field()
  text: string
}

@ObjectType()
class PaginatedPosts {
  @Field(() => [PostEntity])
  posts: PostEntity[]
  @Field()
  hasMore: boolean
}

@Resolver(PostEntity)
export class PostResolver {
  @FieldResolver(() => String)
  textSnippet(@Root() post: PostEntity) {
    return post.text.slice(0, 50)
  }

  @FieldResolver(() => UserEntity)
  async creator(@Root() post: PostEntity, @Ctx() { prisma }: MyContext) {
    return prisma.post
      .findOne({
        where: { id: post.id },
      })
      .creator()
  }

  @FieldResolver(() => Int, { nullable: true })
  async voteStatus(
    @Root() post: PostEntity,
    @Ctx() { req, prisma }: MyContext,
  ) {
    if (!req.session.userId) {
      return null
    }

    const updoot = await prisma.updoot.findOne({
      where: {
        userId_postId: {
          postId: post.id,
          userId: req.session.userId,
        },
      },
    })

    return updoot ? updoot.value : null
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async vote(
    @Arg('postId', () => Int) postId: number,
    @Arg('value', () => Int) value: number,
    @Ctx() { req, prisma }: MyContext,
  ) {
    const isUpdoot = value !== -1
    const realValue = isUpdoot ? 1 : -1
    const { userId } = req.session

    const updoot = await prisma.updoot.findOne({
      where: {
        userId_postId: {
          postId,
          userId,
        },
      },
    })

    const post = await prisma.post.findOne({
      where: { id: postId },
      select: { points: true },
    })
    if (!post) {
      return false
    }

    if (updoot && updoot.value !== realValue) {
      // the user has voted on the post before
      // and they are changing their vote
      const op1 = prisma.updoot.update({
        where: {
          userId_postId: { userId, postId },
        },
        data: {
          value: realValue,
        },
      })
      const op2 = prisma.post.update({
        where: { id: postId },
        data: {
          points: (post.points || 0) + 2 * realValue,
        },
      })
      await prisma.$transaction([op1, op2])
    } else if (!updoot) {
      // has never voted before
      const op1 = prisma.updoot.create({
        data: {
          value: realValue,
          user: { connect: { id: userId } },
          post: { connect: { id: postId } },
        },
      })
      const op2 = prisma.post.update({
        where: { id: postId },
        data: {
          points: (post.points || 0) + 2 * realValue,
        },
      })
      await prisma.$transaction([op1, op2])
    }
    return true
  }

  @Query(() => PaginatedPosts)
  async posts(
    @Arg('limit', () => Int) limit: number,
    @Arg('cursor', () => String, { nullable: true }) cursor: string | null,
    @Ctx() { prisma }: MyContext,
  ): Promise<PaginatedPosts> {
    // 20 -> 21
    const realLimit = Math.min(50, limit)
    const reaLimitPlusOne = realLimit + 1

    const replacements: any[] = [reaLimitPlusOne]

    if (cursor) {
      const cursorDate = new Date(parseInt(cursor))
      replacements.push(cursorDate.toISOString())
    }

    /**
     * Seems like they're using `createdAt` as the cursor. Is that possible in Prisma?
     * Seems like Prisma only supports `@unique` cursor fields, in this case that's only `id`.
     */

    const query = `
    select p.*
    from post p
    ${cursor ? `where p."createdAt" < '${replacements[1]}'::date` : ''}
    order by p."createdAt" DESC
    limit ${limit};
    `
    const posts = await prisma.$queryRaw(query)

    return {
      posts: posts.slice(0, realLimit),
      hasMore: posts.length === reaLimitPlusOne,
    }
  }

  @Query(() => PostEntity, { nullable: true })
  async post(
    @Arg('id', () => Int) id: number,
    @Ctx() { prisma }: MyContext,
  ): Promise<PostEntity | null> {
    const post = await prisma.post.findOne({
      where: { id },
    })
    return post as PostEntity
  }

  @Mutation(() => PostEntity)
  @UseMiddleware(isAuth)
  async createPost(
    @Arg('input') input: PostInput,
    @Ctx() { req, prisma }: MyContext,
  ): Promise<PostEntity> {
    const post = await prisma.post.create({
      data: {
        title: input.title,
        text: input.text,
        creator: {
          connect: {
            id: req.session.userId,
          },
        },
      },
    }) 
    return post as PostEntity
  }

  @Mutation(() => PostEntity, { nullable: true })
  @UseMiddleware(isAuth)
  async updatePost(
    @Arg('id', () => Int) id: number,
    @Arg('title') title: string,
    @Arg('text') text: string,
    @Ctx() { prisma }: MyContext,
  ): Promise<PostEntity | null> {
    const updatedPost = await prisma.post.update({
      where: {
        id,
      },
      data: {
        title,
        text,
      },
    })
    return updatedPost as PostEntity
  }

  @Mutation(() => Boolean)
  @UseMiddleware(isAuth)
  async deletePost(
    @Arg('id', () => Int) id: number,
    @Ctx() { req, prisma }: MyContext,
  ): Promise<boolean> {
    const post = await prisma.post.findOne({ where: { id } })
    if (!post) {
      return false
    }
    if (post.creatorId !== req.session.userId) {
      throw new Error('not authorized')
    }

    await prisma.updoot.deleteMany({
      where: { postId: post.id },
    })

    await prisma.post.delete({
      where: { id },
    })
    return true
  }
}
