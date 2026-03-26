#!/bin/bash
echo "Installing MySQL..."
sudo apt-get install -y mysql-server -qq

echo "Starting MySQL..."
sudo service mysql start

echo "Setting up database..."
sudo mysql -e "CREATE DATABASE IF NOT EXISTS dominium;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'dominium'@'localhost' IDENTIFIED BY 'dominium123';"
sudo mysql -e "GRANT ALL PRIVILEGES ON dominium.* TO 'dominium'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"
sudo mysql -e "CREATE TABLE IF NOT EXISTS dominium.Utente (idU INT AUTO_INCREMENT PRIMARY KEY, email VARCHAR(100) NOT NULL UNIQUE, password VARCHAR(255) NOT NULL);"

echo "Starting Node.js server..."
node server/server.js