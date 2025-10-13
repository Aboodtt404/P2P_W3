const path = require('path');

module.exports = {
  mode: 'production',
  entry: './src/frontend/app-entry.js',
  output: {
    filename: 'app.js',
    path: path.resolve(__dirname, 'src/frontend/dist'),
  },
  resolve: {
    fallback: {
      "assert": require.resolve("assert/"),
      "buffer": require.resolve("buffer/"),
      "events": require.resolve("events/"),
      "stream": require.resolve("stream-browserify"),
      "util": require.resolve("util/")
    }
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env']
          }
        }
      }
    ]
  }
};

