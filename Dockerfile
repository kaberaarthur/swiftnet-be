# Use the official Node.js image from the Docker Hub
FROM node:20

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (if available) to install dependencies
COPY package*.json ./

# Install app dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Expose the port your Node.js app is running on (e.g., 3000)
EXPOSE 3000

# Command to run your app
CMD ["npm", "start"]
