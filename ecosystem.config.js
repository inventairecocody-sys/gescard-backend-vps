module.exports = {
  apps : [{
    name: 'backend',
    script: 'server.js',
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
      DB_HOST: 'localhost',
      DB_PORT: 5432,
      DB_NAME: 'gescard_db',
      DB_USER: 'jeanluc_ahoua',
      DB_PASSWORD: 'Djono@@100',
      JWT_SECRET: 'Cocody@@100!'
    }
  }]
};