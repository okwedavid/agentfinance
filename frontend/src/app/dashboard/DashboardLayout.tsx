import React from "react";
import { motion } from "framer-motion";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ duration: 0.4 }}
    className="grid grid-cols-1 md:grid-cols-2 gap-6 p-6 w-full max-w-6xl mx-auto"
  >
    {children}
  </motion.div>
);

export default DashboardLayout;
