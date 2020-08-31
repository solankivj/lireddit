# lireddit

This repo is a clone of [Ben Awad](https://github.com/benawad)'s [lireddit](https://github.com/benawad/lireddit) app that he built during his [14h tutorial](https://youtu.be/I6ypD7qv3Z8) on Youtube.

However, this version uses [Prisma](https://github.com/prisma/prisma) instead of TypeORM for database access.

## Usage

### 1. Clone the repo

```
git clone git@github.com:nikolasburk/lireddit.git
cd lireddit
```

### 2. Set up server and database

To set up the server, you need to install the npm dependencies and configure your environment variables.

#### 2.1. Install the npm dependencies

```
cd server
npm install
```

#### 2.2. Set environment variables

Open `.env` and adjust the environment variables to match the setup on your own machine.

#### 2.3. Set up database and create tables

This project uses PostgreSQL as a database and assumes that you already have a PostgreSQL database server running. If you don't have a PostgreSQL database server running right now, you can use SQLite instead (expand below for setup instructions).

To create your database tables, you can use Prisma Migrate via the following commands:

```
npx prisma migrate save --create-db --name "init" --experimental 
npx prisma migrate up --experimental
```

<details><summary>Expand if you don't have a PostgreSQL database server</summary>

You can use SQLite instead of PostgreSQL for a faster setup. To do so, open the `server/prisma/schema.prisma` file and adjust the `datasource` configuration to look as follows:

```prisma
datasource db {
  provider = "sqlite"
  url      = "file:./dev.db"
}
```

Now you can run the same commands and a new SQLite database file will be created for you:

```
npx prisma migrate save --create-db --name "init" --experimental 
npx prisma migrate up --experimental
```

</details>

#### 2.4. Generate Prisma Client

```
npx prisma generate
```

#### 2.5. Start the server

```
npm run dev2
```

### 3. Set up web frontend

To start the app, you have to navigate into the `web` directory, install dependencies and run the app.

```
cd ../web
npm install
npm run dev
```

### 4. Use the app

You can use the app at [http://localhost:3000](http://localhost:3000).
