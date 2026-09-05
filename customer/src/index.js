import React, { Suspense, lazy } from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import reportWebVitals from "./reportWebVitals";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ReservationCart from "./cart/CartDrawer";
const ScanSpace = lazy(() => import("./features/scanspace/ScanSpace"));

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <BrowserRouter>
      <Suspense fallback={<p style={{ padding: 32 }}>Loading…</p>}>
        <Routes>
          <Route path="/scanspace/*" element={<ScanSpace />} />
          <Route path="*" element={<App />} />
        </Routes>
      </Suspense>
      <ReservationCart />
    </BrowserRouter>
  </React.StrictMode>,
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
