import { ObjectType, Field, Int } from "type-graphql";
import { User } from "./User";

@ObjectType()
export class Post  {
  @Field()
  id!: number;

  @Field()
  title!: string;

  @Field()
  text!: string;

  @Field()
  points!: number;

  @Field(() => Int, { nullable: true })
  voteStatus: number | null; // 1 or -1 or null

  @Field()
  creatorId: number;

  @Field(() => User)
  creator: User;

  @Field(() => String)
  createdAt: Date;

  @Field(() => String)
  updatedAt: Date;
}
