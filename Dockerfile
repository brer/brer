# declare image
FROM node:20-alpine as build

# prepare for native addons
# RUN apk update \
#   && apk upgrade \
#   && apk --no-cache add --virtual builds-deps build-base python3

# cd into app dir
WORKDIR /home/app/node

# copy sources
COPY package*.json ./
COPY tsconfig*.json ./
COPY src src/

# build app
RUN npm install \
  && npm run build \
  && npm prune --production \
  && rm -rf src

# declare new (empty) image
FROM node:20-alpine

# cd into app dir
WORKDIR /home/app/node

# get files from build image
COPY --from=build /home/app/node .

# setup security
RUN adduser --disabled-password -s /bin/false app \
  && chown -R app:app /home/app

# use app user
USER app

# open app port
EXPOSE 3000

# run app
CMD ["sh", "-c", "node ./build/start.js"]
