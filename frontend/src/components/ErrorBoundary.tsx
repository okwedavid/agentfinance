"use client";
import React from 'react';

type State = { hasError: boolean };

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<{}>, State> {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // you could send this to analytics
    // console.error(error, info);
  }

  render() {
    if (this.state.hasError) {
      return <div className="p-8 text-white">Something went wrong.</div>;
    }
    return this.props.children as React.ReactNode;
  }
}
