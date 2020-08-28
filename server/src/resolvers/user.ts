import {
  Resolver,
  Mutation,
  Arg,
  Field,
  Ctx,
  ObjectType,
  Query,
  FieldResolver,
  Root,
} from 'type-graphql'
import { MyContext } from '../types'
import { User as UserEntity } from '../entities/User'
import argon2 from 'argon2'
import { COOKIE_NAME, FORGET_PASSWORD_PREFIX } from '../constants'
import { UsernamePasswordInput } from './UsernamePasswordInput'
import { validateRegister } from '../utils/validateRegister'
import { sendEmail } from '../utils/sendEmail'
import { v4 } from 'uuid'

@ObjectType()
class FieldError {
  @Field()
  field: string
  @Field()
  message: string
}

@ObjectType()
class UserResponse {
  @Field(() => [FieldError], { nullable: true })
  errors?: FieldError[]

  @Field(() => UserEntity, { nullable: true })
  user?: UserEntity
}

@Resolver(UserEntity)
export class UserResolver {
  @FieldResolver(() => String)
  email(@Root() user: UserEntity, @Ctx() { req }: MyContext) {
    // this is the current user and its ok to show them their own email
    if (req.session.userId === user.id) {
      return user.email
    }
    // current user wants to see someone elses email
    return ''
  }

  @Mutation(() => UserResponse)
  async changePassword(
    @Arg('token') token: string,
    @Arg('newPassword') newPassword: string,
    @Ctx() { redis, req, prisma }: MyContext,
  ): Promise<UserResponse> {
    if (newPassword.length <= 2) {
      return {
        errors: [
          {
            field: 'newPassword',
            message: 'length must be greater than 2',
          },
        ],
      }
    }

    const key = FORGET_PASSWORD_PREFIX + token
    const userId = await redis.get(key)
    if (!userId) {
      return {
        errors: [
          {
            field: 'token',
            message: 'token expired',
          },
        ],
      }
    }

    const userIdNum = parseInt(userId)
    const user = await prisma.user.findOne({
      where: { id: userIdNum },
    })

    if (!user) {
      return {
        errors: [
          {
            field: 'token',
            message: 'user no longer exists',
          },
        ],
      }
    }

    await prisma.user.update({
      where: { id: userIdNum },
      data: {
        password: await argon2.hash(newPassword),
      },
    })

    await redis.del(key)

    // log in user after change password
    req.session.userId = user.id

    return { user: user as UserEntity }
  }

  @Mutation(() => Boolean)
  async forgotPassword(
    @Arg('email') email: string,
    @Ctx() { redis, prisma }: MyContext,
  ) {
    const user = await prisma.user.findOne({
      where: { email },
    })
    if (!user) {
      // the email is not in the db
      return true
    }

    const token = v4()

    await redis.set(
      FORGET_PASSWORD_PREFIX + token,
      user.id,
      'ex',
      1000 * 60 * 60 * 24 * 3,
    ) // 3 days

    await sendEmail(
      email,
      `<a href="http://localhost:3000/change-password/${token}">reset password</a>`,
    )

    return true
  }

  @Query(() => UserEntity, { nullable: true })
  async me(@Ctx() { req, prisma }: MyContext) {
    // you are not logged in
    console.log(`req.session.userId: ${req.session.userId}`)
    if (!req.session.userId) {
      console.log(`NOT LOGGED IN`)
      return null
    }

    console.log(
      `LOGGED IN, RETRIEVE USER WITH ID ${req.session.userId} FROM DB`,
    )
    const user = await prisma.user.findOne({
      where: { id: req.session.userId },
    })
    return user
  }

  @Mutation(() => UserResponse)
  async register(
    @Arg('options') options: UsernamePasswordInput,
    @Ctx() { req, prisma }: MyContext,
  ): Promise<UserResponse> {
    const errors = validateRegister(options)
    if (errors) {
      return { errors }
    }

    const hashedPassword = await argon2.hash(options.password)
    let user
    try {
      user = await prisma.user.create({
        data: {
          username: options.username,
          email: options.email,
          password: hashedPassword,
        },
      })
    } catch (err) {
      //|| err.detail.includes("already exists")) {
      // duplicate username error
      if (err.code === '23505') {
        return {
          errors: [
            {
              field: 'username',
              message: 'username already taken',
            },
          ],
        }
      }
    }

    if (!user) {
      throw new Error(`user doesn't exist; his shouldn't happen`)
    }

    // store user id session
    // this will set a cookie on the user
    // keep them logged in
    req.session.userId = user.id

    return { user: user as UserEntity }
  }

  @Mutation(() => UserResponse)
  async login(
    @Arg('usernameOrEmail') usernameOrEmail: string,
    @Arg('password') password: string,
    @Ctx() { req, prisma }: MyContext,
  ): Promise<UserResponse> {
    const userByEmail = await prisma.user.findOne({
      where: {
        email: usernameOrEmail,
      },
    })
    const userByUsername = await prisma.user.findOne({
      where: {
        username: usernameOrEmail,
      },
    })
    const user = userByEmail || userByUsername
    if (!user) {
      return {
        errors: [
          {
            field: 'usernameOrEmail',
            message: "that username doesn't exist",
          },
        ],
      }
    }
    const valid = await argon2.verify(user.password, password)
    if (!valid) {
      return {
        errors: [
          {
            field: 'password',
            message: 'incorrect password',
          },
        ],
      }
    }

    req.session.userId = user.id

    return {
      user: user as UserEntity,
    }
  }

  @Mutation(() => Boolean)
  logout(@Ctx() { req, res }: MyContext) {
    return new Promise((resolve) =>
      req.session.destroy((err) => {
        res.clearCookie(COOKIE_NAME)
        if (err) {
          console.log(err)
          resolve(false)
          return
        }

        resolve(true)
      }),
    )
  }
}
