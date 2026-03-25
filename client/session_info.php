<?php
session_start();
header("Content-Type: application/json");
header("Access-Control-Allow-Origin: http://localhost:3000");
header("Access-Control-Allow-Credentials: true");

if (empty($_SESSION["idU"])) {
    // Non loggato: rimanda al login
    echo json_encode(["error" => "not_logged_in"]);
    exit;
}

echo json_encode([
    "idU"   => $_SESSION["idU"],
    "email" => $_SESSION["email"]
]);