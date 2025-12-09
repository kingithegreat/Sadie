const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = (env, argv) => {
  const isDevelopment = argv.mode !== 'production';

  return [
    // Main process configuration
    {
      target: 'electron-main',
      mode: isDevelopment ? 'development' : 'production',
      devtool: isDevelopment ? 'inline-source-map' : false,
      entry: './src/main/index.ts',
      output: {
        path: path.resolve(__dirname, 'dist/main'),
        filename: 'index.js',
        libraryTarget: 'commonjs2'
      },
      resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/
          }
        ]
      },
      node: {
        __dirname: false,
        __filename: false
      }
    },

    // Preload script configuration
    {
      target: 'electron-preload',
      mode: isDevelopment ? 'development' : 'production',
      devtool: isDevelopment ? 'inline-source-map' : false,
      entry: './src/preload/index.ts',
      output: {
        path: path.resolve(__dirname, 'dist/preload'),
        filename: 'index.js',
        libraryTarget: 'commonjs2'
      },
      resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json']
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/
          }
        ]
      },
      node: {
        __dirname: false,
        __filename: false
      }
    },

    // Renderer process configuration
    {
      target: 'web',
      mode: isDevelopment ? 'development' : 'production',
      devtool: isDevelopment ? 'inline-source-map' : false,
      entry: './src/renderer/index.tsx',
      output: {
        path: path.resolve(__dirname, 'dist/renderer'),
        filename: 'index.js'
      },
      resolve: {
        extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
        alias: {
          '@shared': path.resolve(__dirname, 'src/shared'),
          '@renderer': path.resolve(__dirname, 'src/renderer')
        }
      },
      module: {
        rules: [
          {
            test: /\.tsx?$/,
            use: 'ts-loader',
            exclude: /node_modules/
          },
          {
            test: /\.css$/,
            use: ['style-loader', 'css-loader']
          },
          {
            test: /\.(png|jpg|jpeg|gif|svg|ico)$/,
            type: 'asset/resource',
            generator: {
              filename: 'assets/[name][ext]'
            }
          }
        ]
      },
      plugins: [
        new HtmlWebpackPlugin({
          template: './src/renderer/index.html',
          filename: 'index.html',
          inject: 'body'
        })
      ]
    }
  ];
};
