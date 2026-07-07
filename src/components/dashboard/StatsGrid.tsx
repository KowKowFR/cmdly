"use client";

import { motion } from "framer-motion";
import { Server, Shield, Clock, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface StatsGridProps {
  vmCount: number;
  alertCount: number;
  avgUptime: string;
  actionCount: number;
}

interface StatItem {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  accent: string;
}

export function StatsGrid({
  vmCount,
  alertCount,
  avgUptime,
  actionCount,
}: StatsGridProps) {
  const stats: StatItem[] = [
    {
      label: "VMs actives",
      value: vmCount,
      icon: <Server className="w-4 h-4" />,
      accent: "text-sky-400",
    },
    {
      label: "Alertes Wazuh 24h",
      value: alertCount,
      icon: <Shield className="w-4 h-4" />,
      accent: alertCount > 0 ? "text-orange-400" : "text-green-400",
    },
    {
      label: "Uptime moyen",
      value: avgUptime,
      icon: <Clock className="w-4 h-4" />,
      accent: "text-green-400",
    },
    {
      label: "Actions CMDLY 24h",
      value: actionCount,
      icon: <Zap className="w-4 h-4" />,
      accent: "text-violet-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <motion.div
          key={stat.label}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, delay: i * 0.06 }}
        >
          <Card className="h-full">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-medium text-white/40 uppercase tracking-wider">
                  {stat.label}
                </span>
                <span className={stat.accent}>{stat.icon}</span>
              </div>
              <p className="text-3xl font-bold text-white tabular-nums">
                {stat.value}
              </p>
            </CardContent>
          </Card>
        </motion.div>
      ))}
    </div>
  );
}
