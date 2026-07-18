import { Route, Routes } from "react-router-dom";
import Layout from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Transactions from "./pages/Transactions";
import Budget from "./pages/Budget";
import Debts from "./pages/Debts";
import Savings from "./pages/Savings";
import Settings from "./pages/Settings";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/budget" element={<Budget />} />
        <Route path="/debts" element={<Debts />} />
        <Route path="/savings" element={<Savings />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
    </Routes>
  );
}
