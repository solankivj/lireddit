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
import { getConnection } from 'typeorm'
import { Post as PostEntity } from '../entities/Post'
import { User as UserEntity } from '../entities/User'
import { Updoot as UpdootEntity } from '../entities/Updoot'
import { isAuth } from '../middleware/isAuth'
import { MyContext } from '../types'
import { prisma } from '../prisma'

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
  async creator(@Root() post: PostEntity) {
    return prisma.post
      .findOne({
        where: { id: post.id },
      })
      .creator()
  }

  @FieldResolver(() => Int, { nullable: true })
  async voteStatus(@Root() post: PostEntity, @Ctx() { req }: MyContext) {
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
    @Ctx() { req }: MyContext,
  ) {
    const isUpdoot = value !== -1
    const realValue = isUpdoot ? 1 : -1
    const { userId } = req.session

    const updoot = await UpdootEntity.findOne({ where: { postId, userId } })

    // the user has voted on the post before
    // and they are changing their vote
    if (updoot && updoot.value !== realValue) {
      await getConnection().transaction(async (tm) => {
        await tm.query(
          `
    update updoot
    set value = $1
    where "postId" = $2 and "userId" = $3
        `,
          [realValue, postId, userId],
        )

        await tm.query(
          `
          update post
          set points = points + $1
          where id = $2
        `,
          [2 * realValue, postId],
        )
      })
    } else if (!updoot) {
      // has never voted before
      await getConnection().transaction(async (tm) => {
        await tm.query(
          `
    insert into updoot ("userId", "postId", value)
    values ($1, $2, $3)
        `,
          [userId, postId, realValue],
        )

        await tm.query(
          `
    update post
    set points = points + $1
    where id = $2
      `,
          [realValue, postId],
        )
      })
    }
    return true
  }

  @Query(() => PaginatedPosts)
  async posts(
    @Arg('limit', () => Int) limit: number,
    @Arg('cursor', () => String, { nullable: true }) cursor: string | null,
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
    const prismaPosts = await prisma.$queryRaw(query)

    // const posts = await getConnection().query(
    //   `
    // select p.*
    // from post p
    // ${cursor ? `where p."createdAt" < $2` : ''}
    // order by p."createdAt" DESC
    // limit $1
    // `,
    //   replacements,
    // )

    return {
      posts: prismaPosts.slice(0, realLimit),
      hasMore: prismaPosts.length === reaLimitPlusOne,
    }
  }

  @Query(() => PostEntity, { nullable: true })
  async post(@Arg('id', () => Int) id: number): Promise<PostEntity | null> {
    const post = await prisma.post.findOne({
      where: { id },
    })
    return post as PostEntity
  }

  @Mutation(() => PostEntity)
  @UseMiddleware(isAuth)
  async createPost(
    @Arg('input') input: PostInput,
    @Ctx() { req }: MyContext,
  ): Promise<PostEntity> {
    const post = (await prisma.post.create({
      data: {
        title: input.title,
        text: input.text,
        creator: {
          connect: {
            id: req.session.userId,
          },
        },
      },
    })) as PostEntity
    return post
  }

  @Mutation(() => PostEntity, { nullable: true })
  @UseMiddleware(isAuth)
  async updatePost(
    @Arg('id', () => Int) id: number,
    @Arg('title') title: string,
    @Arg('text') text: string,
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
    @Ctx() { req }: MyContext,
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
