import React from "react";

export const Card = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`rounded-xl border border-gray-200 bg-white shadow-sm ${className}`}>
    {children}
  </div>
);

export const CardHeader = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`border-b border-gray-100 px-6 py-4 ${className}`}>{children}</div>
);

export const CardContent = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => <div className={`px-6 py-4 ${className}`}>{children}</div>;

export const CardFooter = ({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div className={`border-t border-gray-100 px-6 py-4 ${className}`}>{children}</div>
);
