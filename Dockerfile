# Adjust NODE_VERSION as desired
ARG NODE_VERSION=22.12.0
FROM node:${NODE_VERSION}-slim as base

LABEL fly_launch_runtime="Node.js"

# Node.js app lives here
WORKDIR /app




# Throw-away build stage to reduce size of final image
FROM base as build

# Install node modules
COPY --link package-lock.json package.json ./
RUN npm install

# Copy application code
COPY --link . .

# Build application
RUN npm run build

# Remove development dependencies
RUN npm prune --production


# Final stage for app image
FROM base

# Set production environment
ENV NODE_ENV="production"

# Copy built application
COPY --from=build /app/build /app/build
COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/package.json

# Start the server by default, this can be overwritten at runtime
EXPOSE 3000
CMD [ "npm", "run", "start" ]